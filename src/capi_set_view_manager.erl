%% @author Couchbase <info@couchbase.com>
%% @copyright 2011 Couchbase, Inc.
%%
%% Licensed under the Apache License, Version 2.0 (the "License");
%% you may not use this file except in compliance with the License.
%% You may obtain a copy of the License at
%%
%%      http://www.apache.org/licenses/LICENSE-2.0
%%
%% Unless required by applicable law or agreed to in writing, software
%% distributed under the License is distributed on an "AS IS" BASIS,
%% WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
%% See the License for the specific language governing permissions and
%% limitations under the License.
%%

-module(capi_set_view_manager).

-behaviour(gen_server).

-export([init/1, handle_call/3, handle_cast/2,
         handle_info/2, terminate/2, code_change/3]).

-export([start_link/1]).

%% API
-export([set_vbucket_states/3, server/1,
         wait_index_updated/2, initiate_indexing/1, reset_master_vbucket/1]).

-include("couch_db.hrl").
-include_lib("couch_set_view/include/couch_set_view.hrl").
-include("ns_common.hrl").

-record(state, {bucket :: bucket_name(),
                proxy_server_name :: atom(),
                remote_nodes = [],
                local_docs = [] :: [#doc{}],
                num_vbuckets :: non_neg_integer(),
                use_replica_index :: boolean(),
                master_db_watcher :: pid(),
                wanted_states :: [missing | active | replica],
                rebalance_states :: [rebalance_vbucket_state()],
                usable_vbuckets}).

set_vbucket_states(Bucket, WantedStates, RebalanceStates) ->
    gen_server:call(server(Bucket), {set_vbucket_states, WantedStates, RebalanceStates}, infinity).

wait_index_updated(Bucket, VBucket) ->
    gen_server:call(server(Bucket), {wait_index_updated, VBucket}, infinity).

initiate_indexing(Bucket) ->
    gen_server:call(server(Bucket), initiate_indexing, infinity).

reset_master_vbucket(Bucket) ->
    gen_server:call(server(Bucket), reset_master_vbucket, infinity).

-define(csv_call(Call, Args),
        %% hack to not introduce any variables in the caller environment
        ((fun () ->
                  %% we may want to downgrade it to ?views_debug at some point
                  ?views_debug("~nCalling couch_set_view:~p(~p)", [Call, Args]),
                  try
                      {__Time, __Result} = timer:tc(couch_set_view, Call, Args),

                      ?views_debug("~ncouch_set_view:~p(~p) returned ~p in ~bms",
                                   [Call, Args, __Result, __Time div 1000]),
                      __Result
                  catch
                      __T:__E ->
                          ?views_debug("~ncouch_set_view:~p(~p) raised ~p:~p",
                                       [Call, Args, __T, __E]),

                          %% rethrowing the exception
                          __Stack = erlang:get_stacktrace(),
                          erlang:raise(__T, __E, __Stack)
                  end
          end)())).


compute_index_states(WantedStates, RebalanceStates, ExistingVBuckets) ->
    AllVBs = lists:seq(0, erlang:length(WantedStates)-1),
    Triples = lists:zip3(AllVBs,
                         WantedStates,
                         RebalanceStates),
    % Ensure Active, Passive and Replica are ordsets
    {Active, Passive, Replica} = lists:foldr(
                                   fun ({VBucket, WantedState, TmpState}, {AccActive, AccPassive, AccReplica}) ->
                                           case sets:is_element(VBucket, ExistingVBuckets) of
                                               true ->
                                                   case {WantedState, TmpState} of
                                                       %% {replica, passive} ->
                                                       %%     {AccActibe, [VBucket | AccPassive], [VBucket | AccReplica]};
                                                       {_, passive} ->
                                                           {AccActive, [VBucket | AccPassive], AccReplica};
                                                       {active, _} ->
                                                           {[VBucket | AccActive], AccPassive, AccReplica};
                                                       {replica, _} ->
                                                           {AccActive, AccPassive, [VBucket | AccReplica]};
                                                       _ ->
                                                           {AccActive, AccPassive, AccReplica}
                                                   end;
                                               false ->
                                                   {AccActive, AccPassive, AccReplica}
                                           end
                                   end,
                                   {[], [], []},
                                   Triples),
    AllMain = ordsets:union(Active, Passive),
    MainCleanup = ordsets:subtract(AllVBs, AllMain),
    ReplicaCleanup = ordsets:subtract(ordsets:subtract(AllVBs, Replica), Active),
    PauseVBuckets = [VBucket
                     || {VBucket, WantedState, TmpState} <- Triples,
                        TmpState =:= paused,
                        sets:is_element(VBucket, ExistingVBuckets),
                        begin
                            active = WantedState,
                            true
                        end],
    UnpauseVBuckets = ordsets:subtract(AllVBs, PauseVBuckets),
    {Active, Passive, MainCleanup, Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets}.

get_usable_vbuckets_set(Bucket) ->
    PrefixLen = erlang:length(Bucket) + 1,
    sets:from_list(
      [list_to_integer(binary_to_list(VBucketName))
       || FullName <- ns_storage_conf:bucket_databases(Bucket),
          <<_:PrefixLen/binary, VBucketName/binary>> <- [FullName],
          VBucketName =/= <<"master">>]).

do_apply_vbucket_states(SetName, Active, Passive, MainCleanup, Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets, State) ->
    DDocIds = get_live_ddoc_ids(State),
    RVs = [{DDocId, (catch begin
                               apply_index_states(SetName, DDocId,
                                                  Active, Passive, MainCleanup, Replica, ReplicaCleanup,
                                                  PauseVBuckets, UnpauseVBuckets,
                                                  State),
                               ok
                           end)}
           || DDocId <- DDocIds],
    BadDDocs = [Pair || {_Id, Val} = Pair <- RVs,
                        Val =/= ok],
    case BadDDocs of
        [] ->
            ok;
        _ ->
            ?log_error("Failed to apply index states for the following ddocs:~n~p", [BadDDocs])
    end,
    ok.

change_vbucket_states(#state{bucket = Bucket,
                             wanted_states = WantedStates,
                             rebalance_states = RebalanceStates,
                             usable_vbuckets = UsableVBuckets} = State) ->
    SetName = list_to_binary(Bucket),
    {Active, Passive, MainCleanup, Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets} =
        compute_index_states(WantedStates, RebalanceStates, UsableVBuckets),
    do_apply_vbucket_states(SetName, Active, Passive, MainCleanup, Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets, State).

start_link(Bucket) ->
    {ok, BucketConfig} = ns_bucket:get_bucket(Bucket),
    case ns_bucket:bucket_type(BucketConfig) of
        memcached ->
            ignore;
        _ ->
            UseReplicaIndex = (proplists:get_value(replica_index, BucketConfig) =/= false),
            VBucketsCount = proplists:get_value(num_vbuckets, BucketConfig),

            gen_server:start_link({local, server(Bucket)}, ?MODULE,
                                  {Bucket, UseReplicaIndex, VBucketsCount}, [])
    end.

init({Bucket, UseReplicaIndex, NumVBuckets}) ->
    process_flag(trap_exit, true),
    Self = self(),

    %% Update myself whenever the config changes (rebalance)
    ns_pubsub:subscribe_link(
      ns_config_events,
      fun (_, _) -> Self ! replicate_newnodes_docs end,
      empty),

    {ok, DDocReplicationProxy} = capi_ddoc_replication_srv:start_link(Bucket),
    erlang:put('ddoc_replication_proxy', DDocReplicationProxy),

    {ok, Db} = open_local_db(Bucket),
    Docs = try
               {ok, ADocs} = couch_db:get_design_docs(Db, deleted_also),
               ADocs
           after
               ok = couch_db:close(Db)
           end,
    %% anytime we disconnect or reconnect, force a replicate event.
    ns_pubsub:subscribe_link(
      ns_node_disco_events,
      fun ({ns_node_disco_events, _Old, _New}, _) ->
              Self ! replicate_newnodes_docs
      end,
      empty),
    Self ! replicate_newnodes_docs,

    %% Explicitly ask all available nodes to send their documents to us
    ServerName = capi_ddoc_replication_srv:proxy_server_name(Bucket),
    [{ServerName, N} ! replicate_newnodes_docs ||
        N <- get_remote_nodes(Bucket)],

    ns_pubsub:subscribe_link(mc_couch_events,
                             mk_mc_couch_event_handler(Bucket), ignored),

    State = #state{bucket=Bucket,
                   proxy_server_name = ServerName,
                   local_docs = Docs,
                   num_vbuckets = NumVBuckets,
                   use_replica_index=UseReplicaIndex,
                   wanted_states = [],
                   rebalance_states = [],
                   usable_vbuckets = get_usable_vbuckets_set(Bucket)},

    ?log_debug("Usable vbuckets:~n~p", [sets:to_list(State#state.usable_vbuckets)]),

    proc_lib:init_ack({ok, self()}),

    [maybe_define_group(DDocId, State)
     || DDocId <- get_live_ddoc_ids(State)],

    gen_server:enter_loop(?MODULE, [], State).

get_live_ddoc_ids(#state{local_docs = Docs}) ->
    [Id || #doc{id = Id, deleted = false} <- Docs].

handle_call({wait_index_updated, VBucket}, From, State) ->
    ok = proc_lib:start_link(erlang, apply, [fun do_wait_index_updated/4, [From, VBucket, self(), State]]),
    {noreply, State};
handle_call(initiate_indexing, _From, State) ->
    BinBucket = list_to_binary(State#state.bucket),
    DDocIds = get_live_ddoc_ids(State),
    [case DDocId of
         <<"_design/dev_", _/binary>> -> ok;
         _ ->
             couch_set_view:trigger_update(mapreduce_view, BinBucket, DDocId, 0)
     end || DDocId <- DDocIds],
    {reply, ok, State};
handle_call({interactive_update, #doc{id=Id}=Doc}, _From, State) ->
    #state{local_docs=Docs}=State,
    Rand = crypto:rand_uniform(0, 16#100000000),
    RandBin = <<Rand:32/integer>>,
    NewRev = case lists:keyfind(Id, #doc.id, Docs) of
                 false ->
                     {1, RandBin};
                 #doc{rev = {Pos, _DiskRev}} ->
                     {Pos + 1, RandBin}
             end,
    NewDoc = Doc#doc{rev=NewRev},
    try
        ?log_debug("Writing interactively saved ddoc ~p", [Doc]),
        SavedDocState = save_doc(NewDoc, State),
        replicate_change(SavedDocState, NewDoc),
        {reply, ok, SavedDocState}
    catch throw:{invalid_design_doc, _} = Error ->
            ?log_debug("Document validation failed: ~p", [Error]),
            {reply, Error, State}
    end;
handle_call({foreach_doc, Fun}, _From, #state{local_docs = Docs} = State) ->
    Res = [{Id, (catch Fun(Doc))} || #doc{id = Id} = Doc <- Docs],
    {reply, Res, State};
handle_call({set_vbucket_states, WantedStates, RebalanceStates}, _From,
            State) ->
    State2 = State#state{wanted_states = WantedStates,
                         rebalance_states = RebalanceStates},
    case State2 =:= State of
        true ->
            {reply, ok, State};
        false ->
            change_vbucket_states(State2),
            {reply, ok, State2}
    end;

handle_call({delete_vbucket, VBucket}, _From, #state{bucket = Bucket,
                                                     wanted_states = [],
                                                     usable_vbuckets = UsableVBuckets,
                                                     rebalance_states = RebalanceStates} = State) ->
    [] = RebalanceStates,
    ?log_info("Deleting vbucket ~p from all indexes", [VBucket]),
    SetName = list_to_binary(Bucket),
    do_apply_vbucket_states(SetName, [], [], [VBucket], [], [VBucket], [], [], State),
    {reply, ok, State#state{usable_vbuckets = sets:del_element(VBucket, UsableVBuckets)}};
handle_call({delete_vbucket, VBucket}, _From, #state{usable_vbuckets = UsableVBuckets,
                                                     wanted_states = WantedStates,
                                                     rebalance_states = RebalanceStates} = State) ->
    NewUsableVBuckets = sets:del_element(VBucket, UsableVBuckets),
    case NewUsableVBuckets =:= UsableVBuckets of
        true ->
            {reply, ok, State};
        _ ->
            NewState = State#state{usable_vbuckets = NewUsableVBuckets},
            case (lists:nth(VBucket+1, WantedStates) =:= missing
                  andalso lists:nth(VBucket+1, RebalanceStates) =:= undefined) of
                true ->
                    %% skipping vbucket changes pass iff it's totally
                    %% uninteresting vbucket
                    ok;
                false ->
                    change_vbucket_states(NewState)
            end,
            {reply, ok, NewState}
    end;
handle_call(reset_master_vbucket, _From, #state{bucket = Bucket,
                                                local_docs = LocalDocs} = State) ->
    MasterVBucket = iolist_to_binary([Bucket, <<"/master">>]),
    {ok, master_db_deletion} = {couch_server:delete(MasterVBucket, []), master_db_deletion},
    {ok, MasterDB} = open_local_db(Bucket),
    ok = couch_db:close(MasterDB),
    [save_doc(Doc, State) || Doc <- LocalDocs],
    {reply, ok, State}.


handle_cast({replicated_update, #doc{id=Id, rev=Rev}=Doc}, State) ->
    %% this is replicated from another node in the cluster. We only accept it
    %% if it doesn't exist or the rev is higher than what we have.
    #state{local_docs=Docs} = State,
    Proceed = case lists:keyfind(Id, #doc.id, Docs) of
                  false ->
                      true;
                  #doc{rev = DiskRev} when Rev > DiskRev ->
                      true;
                  _ ->
                      false
              end,
    if Proceed ->
            ?log_debug("Writing replicated ddoc ~p", [Doc]),
            {noreply, save_doc(Doc, State)};
       true ->
            {noreply, State}
    end.

aggregate_update_ddoc_messages(DDocId, Deleted) ->
    receive
        {update_ddoc, DDocId, NewDeleted} ->
            aggregate_update_ddoc_messages(DDocId, NewDeleted)
    after 0 ->
            Deleted
    end.

handle_info({'DOWN', _Ref, _Type, {Server, RemoteNode}, Error},
            #state{remote_nodes = RemoteNodes} = State) ->
    ?log_warning("Remote server node ~p process down: ~p",
                 [{Server, RemoteNode}, Error]),
    {noreply, State#state{remote_nodes=RemoteNodes -- [RemoteNode]}};
handle_info(replicate_newnodes_docs, State) ->
    ?log_debug("doing replicate_newnodes_docs"),
    {noreply, replicate_newnodes_docs(State)};
handle_info({update_ddoc, DDocId, Deleted0}, State) ->
    Deleted = aggregate_update_ddoc_messages(DDocId, Deleted0),
    ?log_info("Processing update_ddoc ~s (~p)", [DDocId, Deleted]),
    case Deleted of
        false ->
            %% we need to redefine set view whenever document changes; but
            %% previous group for current value of design document can
            %% still be alive; thus using maybe_define_group
            maybe_define_group(DDocId, State),
            change_vbucket_states(State),
            State;
        true ->
            ok
    end,
    {noreply, State};

handle_info(refresh_usable_vbuckets,
            #state{bucket=Bucket,
                   usable_vbuckets = OldUsableVBuckets} = State) ->
    misc:flush(refresh_usable_vbuckets),
    NewUsableVBuckets = get_usable_vbuckets_set(Bucket),
    case NewUsableVBuckets =:= OldUsableVBuckets of
        true ->
            {noreply, State};
        false ->
            State2 = State#state{usable_vbuckets = NewUsableVBuckets},
            ?log_debug("Usable vbuckets:~n~p", [sets:to_list(State2#state.usable_vbuckets)]),
            change_vbucket_states(State2),
            {noreply, State2}
    end;

handle_info({'EXIT', Pid, Reason}, State) ->
    ?views_error("Linked process ~p died unexpectedly: ~p", [Pid, Reason]),
    {stop, {linked_process_died, Pid, Reason}, State};

handle_info(Info, State) ->
    ?log_info("Ignoring unexpected message: ~p", [Info]),
    {noreply, State}.

terminate(_Reason, _State) ->
    case erlang:get('ddoc_replication_proxy') of
        Pid when is_pid(Pid) ->
            erlang:exit(Pid, kill),
            misc:wait_for_process(Pid, infinity);
        _ ->
            ok
    end,
    ok.

code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

server(Bucket) when is_binary(Bucket) ->
    server(erlang:binary_to_list(Bucket));
server(Bucket) ->
    list_to_atom(?MODULE_STRING ++ "-" ++ Bucket).

maybe_define_group(DDocId,
                   #state{bucket = Bucket,
                          num_vbuckets = NumVBuckets,
                          use_replica_index = UseReplicaIndex} = _State) ->
    SetName = list_to_binary(Bucket),
    Params = #set_view_params{max_partitions=NumVBuckets,
                              active_partitions=[],
                              passive_partitions=[],
                              use_replica_index=UseReplicaIndex},

    try
        ok = ?csv_call(define_group, [mapreduce_view, SetName, DDocId, Params])
    catch
        throw:{not_found, deleted} ->
            %% The document has been deleted but we still think it's
            %% alive. Eventually we will get a notification from master db
            %% watcher and delete it from a list of design documents.
            ok;
        throw:view_already_defined ->
            already_defined
    end.

define_and_reapply_index_states(SetName, DDocId, Active, Passive, Cleanup,
                                Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                                State, OriginalException, NowException) ->
    ?log_info("Got view_undefined exception:~n~p", [NowException]),
    case OriginalException of
        undefined ->
            ok;
        _ ->
            ?log_error("Got second exception after trying to redefine undefined view:~n~p~nOriginal exception was:~n~p",
                       [NowException, OriginalException]),
            erlang:apply(erlang, raise, OriginalException)
    end,
    maybe_define_group(DDocId, State),
    apply_index_states(SetName, DDocId, Active, Passive, Cleanup,
                       Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                       State, NowException).

apply_index_states(SetName, DDocId, Active, Passive, Cleanup,
                   Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                   State) ->
    apply_index_states(SetName, DDocId, Active, Passive, Cleanup,
                       Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                       State, undefined).

apply_index_states(SetName, DDocId, Active, Passive, Cleanup,
                   Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                   #state{use_replica_index = UseReplicaIndex} = State,
                   PastException) ->

    try
        PausingOn = cluster_compat_mode:is_index_pausing_on(),
        case PausingOn of
            false ->
                ok;
            true ->
                ok = ?csv_call(mark_partitions_indexable,
                               [mapreduce_view, SetName, DDocId,
                                UnpauseVBuckets])
        end,

        %% this should go first because some of the replica vbuckets might
        %% need to be cleaned up from main index
        ok = ?csv_call(set_partition_states,
                       [mapreduce_view, SetName, DDocId, Active, Passive,
                        Cleanup]),

        case UseReplicaIndex of
            true ->
                ok = ?csv_call(add_replica_partitions,
                               [mapreduce_view, SetName, DDocId, Replica]),
                ok = ?csv_call(remove_replica_partitions,
                               [mapreduce_view, SetName, DDocId,
                                ReplicaCleanup]);
            false ->
                ok
        end,

        case PausingOn of
            false ->
                ok;
            true ->
                ok = ?csv_call(mark_partitions_unindexable,
                               [mapreduce_view, SetName, DDocId,
                                PauseVBuckets])
        end

    catch
        throw:{not_found, deleted} ->
            %% The document has been deleted but we still think it's
            %% alive. Eventually we will get a notification from master db
            %% watcher and delete it from a list of design documents.
            ok;
        T:E ->
            Stack = erlang:get_stacktrace(),
            Exc = [T, E, Stack],
            Undefined = case Exc of
                            [throw, {error, view_undefined}, _] ->
                                true;
                            [error, view_undefined, _] ->
                                true;
                            _ ->
                                false
                        end,
            case Undefined of
                true ->
                    define_and_reapply_index_states(
                      SetName, DDocId, Active, Passive, Cleanup,
                      Replica, ReplicaCleanup, PauseVBuckets, UnpauseVBuckets,
                      State, PastException, Exc);
                _ ->
                    erlang:raise(T, E, Stack)
            end
    end.

mk_mc_couch_event_handler(Bucket) ->
    Self = self(),

    fun (Event, _) ->
            handle_mc_couch_event(Self, Bucket, Event)
    end.

handle_mc_couch_event(Self, Bucket,
                      {set_vbucket, Bucket, VBucket, State, Checkpoint}) ->
    ?views_debug("Got set_vbucket event for ~s/~b. Updated state: ~p (~B)",
                 [Bucket, VBucket, State, Checkpoint]),
    Self ! refresh_usable_vbuckets;
handle_mc_couch_event(Self, Bucket,
                      {delete_vbucket, Bucket, VBucket}) ->
    ok = gen_server:call(Self, {delete_vbucket, VBucket}, infinity);
handle_mc_couch_event(_, _, _) ->
    ok.

replicate_newnodes_docs(State) ->
    #state{bucket=Bucket,
           proxy_server_name = ServerName,
           remote_nodes=OldNodes,
           local_docs = Docs} = State,
    AllNodes = get_remote_nodes(Bucket),
    NewNodes = AllNodes -- OldNodes,
    case NewNodes of
        [] ->
            ok;
        _ ->
            [monitor(process, {ServerName, Node}) || Node <- NewNodes],
            [replicate_change_to_node(ServerName, S, D)
             || S <- NewNodes,
                D <- Docs]
    end,
    State#state{remote_nodes=AllNodes}.

replicate_change_to_node(ServerName, Node, Doc) ->
    ?log_debug("Sending ~s to ~s", [Doc#doc.id, Node]),
    gen_server:cast({ServerName, Node}, {replicated_update, Doc}).


get_remote_nodes(Bucket) ->
    case ns_bucket:get_bucket(Bucket) of
        {ok, Conf} ->
            proplists:get_value(servers, Conf) -- [node()];
        not_present ->
            []
    end.

open_local_db(Bucket) ->
    MasterVBucket = iolist_to_binary([Bucket, <<"/master">>]),
    case couch_db:open(MasterVBucket, []) of
        {ok, Db} ->
            {ok, Db};
        {not_found, _} ->
            couch_db:create(MasterVBucket, [])
    end.

replicate_change(#state{proxy_server_name = ServerName,
                        remote_nodes=Nodes}, Doc) ->
    [replicate_change_to_node(ServerName, Node, Doc) || Node <- Nodes],
    ok.

save_doc(#doc{id = Id} = Doc,
         #state{bucket=Bucket, local_docs=Docs}=State) ->
    {ok, Db} = open_local_db(Bucket),
    try
        ok = couch_db:update_doc(Db, Doc)
    after
        ok = couch_db:close(Db)
    end,
    self() ! {update_ddoc, Id, Doc#doc.deleted},
    State#state{local_docs = lists:keystore(Id, #doc.id, Docs, Doc)}.

do_wait_index_updated({Pid, _} = From, VBucket,
                      ParentPid, #state{bucket = Bucket} = State) ->
    DDocIds = get_live_ddoc_ids(State),
    BinBucket = list_to_binary(Bucket),
    Refs = lists:foldl(
             fun (DDocId, Acc) ->
                     case DDocId of
                         <<"_design/dev_", _/binary>> -> Acc;
                         _ ->
                             Ref = couch_set_view:monitor_partition_update(
                                     mapreduce_view, BinBucket, DDocId,
                                     VBucket),
                             couch_set_view:trigger_update(
                               mapreduce_view, BinBucket, DDocId, 0),
                             [Ref | Acc]
                     end
             end, [], DDocIds),
    ?log_debug("References to wait: ~p (~p, ~p)", [Refs, Bucket, VBucket]),
    ParentMRef = erlang:monitor(process, ParentPid),
    CallerMRef = erlang:monitor(process, Pid),
    proc_lib:init_ack(ok),
    erlang:unlink(ParentPid),
    [receive
         {Ref, Msg} -> % Ref is bound
             case Msg of
                 updated -> ok;
                 _ ->
                     ?log_debug("Got unexpected message from ddoc monitoring. Assuming that's shutdown: ~p", [Msg])
             end;
         {'DOWN', ParentMRef, _, _, _} = DownMsg ->
             ?log_debug("Parent died: ~p", [DownMsg]),
             exit({parent_exited, DownMsg});
         {'DOWN', CallerMRef, _, _, _} = DownMsg ->
             ?log_debug("Caller died: ~p", [DownMsg]),
             exit(normal)
     end
     || Ref <- Refs],
    ?log_debug("All refs fired"),
    gen_server:reply(From, ok).

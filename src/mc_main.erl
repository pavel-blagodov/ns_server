-module(mc_main).

-include_lib("eunit/include/eunit.hrl").

-export([start/1, start/2, start_link/1, start_link/2, init/2]).

% Starting the server...
%
% Example:
%
%   mc_main:start(PortNum,
%                 {ProtocolModuleName, {ProcessorModuleName, ProcessorArgs}}).
%
%   mc_main:start(11222,
%                 {mc_server_ascii,
%                  {mc_server_ascii_dict,
%                   mc_server_ascii_dict:create_dict()}}).
%
% A server ProtocolModule must implement a callback of...
%
%   session(SessionSock, {ProcessorModuleName, ProcessorArgs})
%
start(Handler) ->
    start(11211, Handler).

start(PortNum, Handler) when is_integer(PortNum) ->
    {ok, spawn(?MODULE, init, [PortNum, Handler])}.

start_link(Handler) ->
    start_link(11211, Handler).

start_link(PortNum, Handler) when is_integer(PortNum) ->
    {ok, spawn_link(?MODULE, init, [PortNum, Handler])}.

init(PortNum, Handler) ->
    {ok, LS} = gen_tcp:listen(PortNum, [binary,
                                        {reuseaddr, true},
                                        {packet, raw},
                                        {active, false}]),
    accept_loop(LS, Handler).

% Accept incoming connections
accept_loop(LS, {ModuleName, Args} = Handler) ->
    {ok, NS} = gen_tcp:accept(LS),
    ?debugFmt("accept ~p~n", [NS]),
    Pid = spawn(ModuleName, [NS, Args]),
    gen_tcp:controlling_process(NS, Pid),
    accept_loop(LS, Handler).


/**
   Copyright 2011 Couchbase, Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
 **/
var ServersSection = {
  hostnameComparator: mkComparatorByProp('hostname', naturalSort),
  pendingEject: [], // nodes to eject on next rebalance
  pending: [], // nodes for pending tab
  active: [], // nodes for active tab
  allNodes: [], // all known nodes

  visitTab: function (tabName) {
    if (ThePage.currentSection != 'servers') {
      $('html, body').animate({scrollTop: 0}, 250);
    }
    ThePage.ensureSection('servers');
    this.tabs.setValue(tabName);
  },
  updateData: function () {
    var self = this;
    var serversValue = self.serversCell.value || {};

    _.each("pendingEject pending active allNodes".split(' '), function (attr) {
      self[attr] = serversValue[attr] || [];
    });
  },
  renderEverything: function () {
    var self = this;
    this.detailsWidget.prepareDrawing();

    var details = this.poolDetails.value;
    var rebalancing = details && details.rebalanceStatus != 'none';

    var inRecovery = this.inRecoveryModeCell.value;

    var pending = this.pending;
    var active = this.active;

    $('#js_add_button', self.serversQ).toggle(!!(details && !rebalancing));
    $('#js_stop_rebalance_button', self.serversQ).toggle(!!rebalancing);
    $('#js_stop_recovery_button', self.serversQ).toggle(!!inRecovery);

    var mayRebalance = !rebalancing && !inRecovery && pending.length !=0;

    if (details && !rebalancing && !inRecovery && !details.balanced)
      mayRebalance = true;

    var unhealthyActive = _.detect(active, function (n) {
      return n.clusterMembership == 'active'
        && !n.pendingEject
        && n.status === 'unhealthy'
    })

    if (unhealthyActive)
      mayRebalance = false;

    var rebalanceButton = $('#js_rebalance_button', self.serversQ).toggle(!!details);
    rebalanceButton.toggleClass('disabled', !mayRebalance);

    if (details && !rebalancing) {
      $('#js_rebalance_pend', self.serversQ).text(pending.length);
      $('#js_rebalance_tab', self.serversQ).toggleClass('dynamic_badge_display', !!pending.length);
    } else {
      $('#js_rebalance_tab', self.serversQ).toggleClass('dynamic_badge_display', false);
    }

    self.serversQ.toggleClass('dynamic_rebalancing', !!rebalancing);

    if (!details)
      return;

    if (active.length) {
      renderTemplate('js_manage_server_list', {
        rows: active,
        expandingAllowed: !IOCenter.staleness.value,
        prefix: "active"
      }, $i('js_active_server_list_container'));
      renderTemplate('js_manage_server_list', {
        rows: pending,
        expandingAllowed: true,
        prefix: "pending"
      }, $i('js_pending_server_list_container'));
    }

    if (rebalancing) {
      $('#js_add_button', self.serversQ).hide();
      this.renderRebalance(details);
    }

    if (IOCenter.staleness.value) {
      $('.js_staleness-notice', self.serversQ).show();
      ('#js_add_button, #js_rebalance_button', self.serversQ).hide();
      $('.js_re_add_button, .js_eject_server, .js_failover_server, .js_remove_from_list', self.serversQ).addClass('disabled');
    } else {
      $('.js_staleness-notice', self.serversQ).hide();
      $('#js_rebalance_button', self.serversQ).show();
      $('#js_add_button', self.serversQ)[rebalancing ? 'hide' : 'show']();
    }

    $('#js_active_server_list_container .dynamic_last-active').find('.js_eject_server').addClass('disabled').end()
      .find('.js_failover_server').addClass('disabled');

    $('#js_active_server_list_container .dynamic_server_down .js_eject_server').addClass('disabled');
    $('.dynamic_failed_over .js_eject_server, .dynamic_failed_over .js_failover_server').hide();

    if (inRecovery) {
      $('.js_re_add_button, .js_eject_server, .js_failover_server, .js_remove_from_list', self.serversQ).addClass('disabled');
    }
  },
  renderServerDetails: function (item, element) {
    return this.detailsWidget.renderItemDetails(item, element);
  },
  renderRebalance: function (details) {
    var progress = this.rebalanceProgress.value;
    if (progress) {
      progress = progress.perNode;
    }
    if (!progress) {
      progress = {};
    }
    nodes = _.clone(details.nodes);
    nodes.sort(this.hostnameComparator);
    var emptyProgress = {progress: 0};
    _.each(nodes, function (n) {
      var p = progress[n.otpNode];
      if (!p)
        p = emptyProgress;
      n.progress = p.progress;
      n.percent = truncateTo3Digits(n.progress);
      $("#js_node_" + n.postFix).find('.js_actions').html(jst.serverActions(n));
    });
  },
  refreshEverything: function () {
    this.updateData();
    this.renderEverything();
    // It displays the status of auto-failover, hence we need to refresh
    // it to get the current values
    AutoFailoverSection.refreshStatus();
  },
  onRebalanceProgress: function () {
    var value = this.rebalanceProgress.value;
    if (value.status !== 'running') {
      // if state is not running due to error message and we started
      // that past rebalance
      if (this.sawRebalanceRunning && value.errorMessage) {
        // display message
        this.sawRebalanceRunning = false;
        displayNotice(value.errorMessage, true);
      }
      // and regardless of displaying that error message, exit if not
      // rebalancing
      return;
    }
    this.sawRebalanceRunning = true;

    this.renderRebalance(this.poolDetails.value);
  },
  init: function () {
    var self = this;

    self.poolDetails = DAL.cells.currentPoolDetailsCell;
    self.inRecoveryModeCell = DAL.cells.inRecoveryModeCell;
    self.stopRecoveryURI = Cell.computeEager(function (v) {
      return v.need(DAL.cells.tasksRecoveryCell).stopURI;
    });

    self.tabs = new TabsCell("serversTab",
                             "#servers .js_tabs",
                             "#servers .js_panes > div",
                             ["active", "pending"]);

    var detailsWidget = self.detailsWidget = new MultiDrawersWidget({
      hashFragmentParam: 'openedServers',
      template: 'js_server_details',
      elementKey: 'otpNode',
      placeholderCSS: '#servers .js_settings-placeholder',
      actionLink: 'openServer',
      actionLinkCallback: function () {
        ThePage.ensureSection('servers');
      },
      detailsCellMaker: function (nodeInfo, nodeName) {
        var rebalanceTaskCell = Cell.compute(function (v) {
          var progresses = v.need(DAL.cells.tasksProgressCell);
          return _.find(progresses, function (task) {
            return task.type === 'rebalance' && task.status === 'running';
          }) || undefined;
        });

        var rawNodeDetails = Cell.compute(function (v) {
          return future.get({url:  "/nodes/" + encodeURIComponent(nodeInfo.otpNode)});
        });
        rawNodeDetails.keepValueDuringAsync = true;

        var rv = Cell.compute(function (v) {
          var data = _.clone(v.need(rawNodeDetails));
          var rebalanceTask = v(rebalanceTaskCell);

          if (rebalanceTask &&
              rebalanceTask.detailedProgress &&
              rebalanceTask.detailedProgress.bucket &&
              rebalanceTask.detailedProgress.bucketNumber !== undefined &&
              rebalanceTask.detailedProgress.bucketsCount !== undefined &&
              rebalanceTask.detailedProgress.perNode &&
              rebalanceTask.detailedProgress.perNode[nodeName]) {
            data.detailedProgress = {};

            var ingoing = rebalanceTask.detailedProgress.perNode[nodeName].ingoing;
            if (ingoing.activeVBucketsLeft != 0 ||
                ingoing.replicaVBucketsLeft != 0 ||
                ingoing.docsTotal != 0 ||
                ingoing.docsTransferred != 0) {
              data.detailedProgress.ingoing = ingoing;
            } else {
              data.detailedProgress.ingoing = false;
            }

            var outgoing = rebalanceTask.detailedProgress.perNode[nodeName].outgoing;
            if (outgoing.activeVBucketsLeft != 0 ||
                outgoing.replicaVBucketsLeft != 0 ||
                outgoing.docsTotal != 0 ||
                outgoing.docsTransferred != 0) {
              data.detailedProgress.outgoing = outgoing;
            } else {
              data.detailedProgress.outgoing = false;
            }

            data.detailedProgress.bucket = rebalanceTask.detailedProgress.bucket;
            data.detailedProgress.bucketNumber = rebalanceTask.detailedProgress.bucketNumber;
            data.detailedProgress.bucketsCount = rebalanceTask.detailedProgress.bucketsCount;
          } else {
            data.detailedProgress = false;
          }

          return data;
        });

        rv.delegateInvalidationMethods(rawNodeDetails);

        return rv;
      },
      valueTransformer: function (nodeInfo, nodeSettings) {
        return _.extend({}, nodeInfo, nodeSettings);
      },
      listCell: Cell.compute(function (v) {
        var serversCell = v.need(DAL.cells.serversCell);
        return serversCell.active.concat(serversCell.pending);
      }),
      aroundRendering: function (originalRender, cell, container, nodeInfo) {
        originalRender();
        console.log($("#js_node_" + nodeInfo.postFix).find('.js_expander'))
        $("#js_node_" + nodeInfo.postFix).find('.js_expander').toggleClass('dynamic_closed', !cell.interested.value);
      }
    });

    self.serversCell = DAL.cells.serversCell;

    self.poolDetails.subscribeValue(function (poolDetails) {
      $($.makeArray($('#servers .js_failover_warning')).slice(1)).remove();
      var warning = $('#servers .js_failover_warning');

      if (!poolDetails || poolDetails.rebalanceStatus != 'none') {
        return;
      }

      function showWarning(text) {
        warning.after(warning.clone().find('.warning-text').text(text).end().css('display', 'block'));
      }

      _.each(poolDetails.failoverWarnings, function (failoverWarning) {
        switch (failoverWarning) {
        case 'failoverNeeded':
          break;
        case 'rebalanceNeeded':
          showWarning('Rebalance required, some data is not currently replicated!');
          break;
        case 'hardNodesNeeded':
          showWarning('At least two servers are required to provide replication!');
          break;
        case 'softNodesNeeded':
          showWarning('Additional active servers required to provide the desired number of replicas!');
          break;
        case 'softRebalanceNeeded':
          showWarning('Rebalance recommended, some data does not have the desired number of replicas!');
          break;
        default:
          console.log('Got unknown failover warning: ' + failoverSafety);
        }
      });
    });

    self.serversCell.subscribeAny($m(self, "refreshEverything"));
    self.inRecoveryModeCell.subscribeAny($m(self, "refreshEverything"));

    prepareTemplateForCell('js_active_server_list', self.serversCell);
    prepareTemplateForCell('js_pending_server_list', self.serversCell);

    var serversQ = self.serversQ = $('#servers');

    serversQ.find('#js_rebalance_button').live('click', self.accountForDisabled($m(self, 'onRebalance')));
    serversQ.find('#js_add_button').live('click', $m(self, 'onAdd'));
    serversQ.find('#js_stop_rebalance_button').live('click', $m(self, 'onStopRebalance'));
    serversQ.find('#js_stop_recovery_button').live('click', $m(self, 'onStopRecovery'));

    function mkServerRowHandler(handler) {
      return function (e) {
        var postFix = $(this).attr("data-postfix");
        console.log(postFix)
        var parentRow = $("#js_node_" + postFix);
        var reAddRow = $('#js_server_readd_set_' + postFix);
        var serverRow = parentRow.data('server') || reAddRow.data('server');
        return handler.call(this, e, serverRow);
      }
    }

    function mkServerAction(handler) {
      return ServersSection.accountForDisabled(mkServerRowHandler(function (e, serverRow) {
        e.preventDefault();
        return handler(serverRow.hostname);
      }));
    }

    serversQ.find('.js_re_add_button').live('click', mkServerAction($m(self, 'reAddNode')));
    serversQ.find('.js_eject_server').live('click', mkServerAction($m(self, 'ejectNode')));
    serversQ.find('.js_failover_server').live('click', mkServerAction($m(self, 'failoverNode')));
    serversQ.find('.js_remove_from_list').live('click', mkServerAction($m(self, 'removeFromList')));

    self.rebalanceProgress = Cell.needing(DAL.cells.tasksProgressCell).computeEager(function (v, tasks) {
      for (var i = tasks.length; --i >= 0;) {
        var taskInfo = tasks[i];
        if (taskInfo.type === 'rebalance') {
          return taskInfo;
        }
      }
    }).name("rebalanceProgress");
    self.rebalanceProgress.equality = _.isEqual;
    self.rebalanceProgress.subscribe($m(self, 'onRebalanceProgress'));

    this.stopRebalanceIsSafe = new Cell(function (poolDetails) {
      return poolDetails.stopRebalanceIsSafe;
    }, {poolDetails: self.poolDetails});
  },
  accountForDisabled: function (handler) {
    return function (e) {
      if ($(e.currentTarget).hasClass('disabled')) {
        e.preventDefault();
        return;
      }
      return handler.call(this, e);
    }
  },
  renderUsage: function (e, totals, withQuotaTotal) {
    var options = {
      topAttrs: {'class': "dynamic_usage-block"},
      topRight: ['Total', ViewHelpers.formatMemSize(totals.total)],
      items: [
        {name: 'In Use',
         value: totals.usedByData,
         attrs: {style: 'background-color:#00BCE9'},
         tdAttrs: {style: "color:#1878A2;"}
        },
        {name: 'Other Data',
         value: totals.used - totals.usedByData,
         attrs: {style:"background-color:#FDC90D"},
         tdAttrs: {style: "color:#C19710;"}},
        {name: 'Free',
         value: totals.total - totals.used}
      ],
      markers: []
    };
    if (withQuotaTotal) {
      options.topLeft = ['Couchbase Quota', ViewHelpers.formatMemSize(totals.quotaTotal)];
      options.markers.push({value: totals.quotaTotal,
                            attrs: {style: "background-color:#E43A1B;"}});
    }
    $(e).replaceWith(memorySizesGaugeHTML(options));
  },
  onEnter: function () {
    // we need this 'cause switchSection clears rebalancing class
    this.refreshEverything();
  },
  onLeave: function () {
    this.detailsWidget.reset();
  },
  onRebalance: function () {
    var self = this;

    if (!self.poolDetails.value) {
      return;
    }

    self.postAndReload(self.poolDetails.value.controllers.rebalance.uri,
                       {knownNodes: _.pluck(self.allNodes, 'otpNode').join(','),
                        ejectedNodes: _.pluck(self.pendingEject, 'otpNode').join(',')});
    self.poolDetails.getValue(function () {
      // switch to active server tab when poolDetails reload is complete
      self.tabs.setValue("active");
    });
  },
  onStopRebalance: function () {
    if (!this.poolDetails.value) {
      return;
    }

    if (this.stopRebalanceIsSafe.value) {
      this.postAndReload(this.poolDetails.value.stopRebalanceUri, "");
    } else {
      var self = this;
      showDialogHijackingSave(
        "js_stop_rebalance_confirmation_dialog", ".js_save_button",
        function () {
          self.postAndReload(self.poolDetails.value.stopRebalanceUri, "");
        });
    }
  },
  onStopRecovery: function () {
    var uri = this.stopRecoveryURI.value;
    if (!uri) {
      return;
    }

    this.postAndReload(uri, "");
  },
  validateJoinClusterParams: function (form) {
    var data = {}
    _.each("hostname user password".split(' '), function (name) {
      data[name] = form.find('[name=' + name + ']').val();
    });

    var errors = [];

    if (data['hostname'] == "")
      errors.push("Server IP Address cannot be blank.");
    if (!data['user'] || !data['password']) {
      data['user'] = '';
      data['password'] = '';
    }

    if (!errors.length)
      return data;
    return errors;
  },
  onAdd: function () {
    var self = this;

    if (!self.poolDetails.value) {
      return;
    }

    var uri = self.poolDetails.value.controllers.addNode.uri;

    var dialog = $('#js_join_cluster_dialog');
    var form = $('#js_join_cluster_dialog_form');
    $('#js_join_cluster_dialog_errors_container').empty();
    form.get(0).reset();
    dialog.find("input:not([type]), input[type=text], input[type=password]").val('');
    dialog.find('[name=user]').val('Administrator');

    showDialog('js_join_cluster_dialog', {
      onHide: function () {
        form.unbind('submit');
      }});
    form.bind('submit', function (e) {
      e.preventDefault();

      var errorsOrData = self.validateJoinClusterParams(form);
      if (errorsOrData.length) {
        renderTemplate('js_join_cluster_dialog_errors', errors);
        return;
      }

      var confirmed;

      $('#js_join_cluster_dialog').dialog('option', 'closeOnEscape', false);
      showDialog('js_add_confirmation_dialog', {
        closeOnEscape: false,
        eventBindings: [['.js_save_button', 'click', function (e) {
          e.preventDefault();
          confirmed = true;
          hideDialog('js_add_confirmation_dialog');

          $('#js_join_cluster_dialog_errors_container').empty();
          var overlay = overlayWithSpinner($($i('js_join_cluster_dialog')));

          self.poolDetails.setValue(undefined);

          jsonPostWithErrors(uri, $.param(errorsOrData), function (data, status) {
            self.poolDetails.invalidate();
            overlay.remove();
            if (status != 'success') {
              renderTemplate('js_join_cluster_dialog_errors', data)
            } else {
              hideDialog('js_join_cluster_dialog');
            }
          })
        }]],
        onHide: function () {
          $('#js_join_cluster_dialog').dialog('option', 'closeOnEscape', true);
        }
      });
    });
  },
  findNode: function (hostname) {
    return _.detect(this.allNodes, function (n) {
      return n.hostname == hostname;
    });
  },
  mustFindNode: function (hostname) {
    var rv = this.findNode(hostname);
    if (!rv) {
      throw new Error("failed to find node info for: " + hostname);
    }
    return rv;
  },
  reDraw: function () {
    this.serversCell.invalidate();
  },
  ejectNode: function (hostname) {
    var self = this;

    var node = self.mustFindNode(hostname);
    if (node.pendingEject)
      return;

    showDialogHijackingSave("js_eject_confirmation_dialog", ".js_save_button", function () {
      if (!self.poolDetails.value) {
          return;
      }

      if (node.clusterMembership == 'inactiveAdded') {
        self.postAndReload(self.poolDetails.value.controllers.ejectNode.uri,
                           {otpNode: node.otpNode});
      } else {
        self.pendingEject.push(node);
        self.reDraw();
      }
    });
  },
  failoverNode: function (hostname) {
    var self = this;
    var node;
    showDialogHijackingSave("js_failover_confirmation_dialog", ".js_save_button", function () {
      if (!node)
        throw new Error("must not happen!");
      if (!self.poolDetails.value) {
        return;
      }
      self.postAndReload(self.poolDetails.value.controllers.failOver.uri,
                         {otpNode: node.otpNode}, undefined, {timeout: 120000});
    });
    var dialog = $('#js_failover_confirmation_dialog');
    var overlay = overlayWithSpinner(dialog.find('.js_content').need(1));
    var statusesCell = DAL.cells.nodeStatusesCell;
    statusesCell.setValue(undefined);
    statusesCell.invalidate();
    statusesCell.changedSlot.subscribeOnce(function () {
      overlay.remove();
      dialog.find('.js_warning').hide();
      var statuses = statusesCell.value;
      node = statuses[hostname];
      if (!node) {
        hideDialog("js_failover_confirmation_dialog");
        return;
      }

      var backfill = node.replication < 1;
      var down = node.status != 'healthy';
      var visibleWarning = dialog.find(['.js_warning', down ? 'down' : 'up', backfill ? 'backfill' : 'no_backfill'].join('_')).show();

      var confirmation = visibleWarning.find('[name=confirmation]')
      if (confirmation.length) {
        confirmation.boolAttr('checked', false);
        function onChange() {
          var checked = !!confirmation.attr('checked');
          dialog.find('.js_save_button').boolAttr('disabled', !checked);
        }
        function onHide() {
          confirmation.unbind('change', onChange);
          dialog.unbind('dialog:hide', onHide);
        }
        confirmation.bind('change', onChange);
        dialog.bind('dialog:hide', onHide);
        onChange();
      } else {
        dialog.find(".js_save_button").removeAttr("disabled");
      }
    });
  },
  reAddNode: function (hostname) {
    if (!this.poolDetails.value) {
      return;
    }

    var node = this.mustFindNode(hostname);
    this.postAndReload(this.poolDetails.value.controllers.reAddNode.uri,
                       {otpNode: node.otpNode});
  },
  removeFromList: function (hostname) {
    var node = this.mustFindNode(hostname);

    if (node.pendingEject) {
      this.serversCell.cancelPendingEject(node);
      return;
    }

    var ejectNodeURI = this.poolDetails.value.controllers.ejectNode.uri;
    this.postAndReload(ejectNodeURI, {otpNode: node.otpNode});
  },
  postAndReload: function (uri, data, errorMessage, ajaxOptions) {
    var self = this;
    // keep poolDetails undefined for now
    self.poolDetails.setValue(undefined);
    errorMessage = errorMessage || "Request failed. Check logs."
    jsonPostWithErrors(uri, $.param(data), function (data, status, errorObject) {
      // re-calc poolDetails according to it's formula
      self.poolDetails.invalidate();
      if (status == 'error') {
        if (errorObject && errorObject.mismatch) {
          self.poolDetails.changedSlot.subscribeOnce(function () {
            var msg = "Could not Rebalance because the cluster configuration was modified by someone else.\nYou may want to verify the latest cluster configuration and, if necessary, please retry a Rebalance."
            alert(msg);
          });
        } else {
          displayNotice(errorMessage, true);
        }
      }
    }, ajaxOptions);
  }
};

configureActionHashParam('visitServersTab', $m(ServersSection, 'visitTab'));

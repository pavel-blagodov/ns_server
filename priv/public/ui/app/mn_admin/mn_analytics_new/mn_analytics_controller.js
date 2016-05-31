(function () {
  "use strict";

  angular
    .module('mnAnalyticsNew', [
      'mnAnalyticsNewService',
      'mnPoll',
      'mnBucketsService',
      'ui.router',
      'ui.bootstrap',
      'nvd3',
      'mnBucketsStats',
      'mnSpinner',
      'mnAnalyticsChart'
    ])
    .controller('mnAnalyticsNewController', mnAdminController);

  function mnAdminController($scope, mnAnalyticsNewService, $state, $http, mnPoller, mnBucketsService, $uibModal) {
    var vm = this;

    vm.onSelectBucket = onSelectBucket;
    vm.openChartBuilderDialog = openChartBuilderDialog;
    vm.analyticsService = mnAnalyticsNewService.export;
    vm.showBlocks = {
      "Server Resources": true
    };

    activate();

    function openChartBuilderDialog(directoryName) {
      $uibModal.open({
        templateUrl: 'app/mn_admin/mn_analytics_new/chart_builder/mn_analytics_chart_builder.html',
        controller: 'mnAnalyticsNewChartBuilderController as chartBuilderCtl',
        resolve: {
          bucketName: function () {
            return $state.params.analyticsBucket;
          },
          blockName: function () {
            return directoryName;
          },
          chart: function () {
            return;
          }
        }
      });
    }

    function onSelectBucket() {
      $state.go('app.admin.analytics', {
        analyticsBucket: vm.buckets.bucketsNames.selected
      });
    }

    function activate() {
      new mnPoller($scope, function () {
        return mnAnalyticsNewService.prepareNodesList($state.params);
      })
        .subscribe("nodes", vm)
        .reloadOnScopeEvent("nodesChanged")
        .cycle();

      new mnPoller($scope, function () {
        return mnAnalyticsNewService.getStatsDirectory("/pools/default/buckets//" + $state.params.analyticsBucket + "/statsDirectory?addi=%22all%22&addq=1");
      })
        .subscribe(function (resp) {
          vm.statsDirectoryBlocks = resp.data.blocks;
        }, vm)
        .reloadOnScopeEvent("nodesChanged")
        .cycle();

      new mnPoller($scope, function () {
        return mnBucketsService.getBucketsByType().then(function (buckets) {
          var rv = {};
          rv.bucketsNames = buckets.byType.names;
          rv.bucketsNames.selected = $state.params.analyticsBucket;
          return rv;
        });
      })
        .subscribe("buckets", vm)
        .reloadOnScopeEvent("bucketUriChanged")
        .cycle();
    }
  }
})();

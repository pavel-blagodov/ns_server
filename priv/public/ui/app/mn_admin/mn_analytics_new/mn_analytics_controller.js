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
      'mnSpinner'
    ])
    .controller('mnAnalyticsNewController', mnAdminController)
    .directive('mnAnalyticsChart', mnAnalyticsNewChartDirective);

  function mnAnalyticsNewChartDirective(mnAnalyticsNewService) {
    return {
      restrict: 'A',
      templateUrl: 'app/mn_admin/mn_analytics_new/mn_analytics_chart_directive.html',
      scope: {
        stats: "=",
        id: "@",
        holder: "="
      },
      controller: controller
    };

    function controller($scope, mnPoller) {
      if ($scope.stats.length) {
        activate();
      }
      $scope.options = {
        chart: {
          type: 'lineChart',
          height: 450,
          margin : {
              top: 20,
              right: 20,
              bottom: 40,
              left: 55
          },
          x: function(d){ return d[0] || 0; },
          y: function(d){ return d[1] || 0; },
          useInteractiveGuideline: true,
          transitionDuration:1,
          xAxis: {
              axisLabel: 'Time (ms)'
          },
          yAxis: {
              tickFormat: function(d){
                 return d;
              }
          },
          callback: function(chart){
              console.log("!!! lineChart callback !!!");
          }
        }
      };
      var nodeHost = "127.0.0.1:9000";
      function activate() {
        new mnPoller($scope, function (previousResult) {
          return mnAnalyticsNewService.getBunchOfStats($scope.stats);
        })
        .setInterval(function (response) {
          return response[0].data.interval;
        })
        .subscribe(function (stats) {
          if ($scope.chartData) {
              angular.forEach(stats, function (stat, index) {
                $scope.chartData[index].values.shift();
                $scope.chartData[index].values.push([
                  stat.data.timestamp[stat.data.timestamp.length -1],
                  stat.data.nodeStats[nodeHost][stat.data.nodeStats[nodeHost].length -1],
                ]);
              });
          } else {
            var chartData = [];
            angular.forEach(stats, function (stat, index) {
              chartData.push({
                key: $scope.stats[index].title,
                values: _.zip(stat.data.timestamp, stat.data.nodeStats[nodeHost])
              });
            });
            console.log(chartData)
            $scope.currentStats = stats;
            $scope.chartData = chartData;
          }
        })
        .cycle();
      }
    }
  }

  function mnAdminController($scope, mnAnalyticsNewService, $state, $http, mnPoller, mnBucketsService, $uibModal) {
    var vm = this;

    vm.onSelectBucket = onSelectBucket;
    vm.openChartBuilderDialog = openChartBuilderDialog;
    vm.analyticsService = mnAnalyticsNewService.export;
    vm.showBlocks = {
      "Server Resources": true
    };

    activate();

    function openChartBuilderDialog() {
      $uibModal.open({
        templateUrl: 'app/mn_admin/mn_analytics_new/chart_builder/mn_analytics_chart_builder.html',
        controller: 'mnAnalyticsNewChartBuilderController as chartBuilderCtl'
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
(function () {
  "use strict"

  angular
    .module('mnAnalyticsChart', [
      "mnAnalyticsNewService",
      "ui.bootstrap",
      "mnPoll"
    ])
    .directive("mnAnalyticsChart", mnAnalyticsNewChartDirective);

  function mnAnalyticsNewChartDirective(mnAnalyticsNewService, $uibModal, $state, mnPoller) {
    return {
      restrict: 'A',
      templateUrl: 'app/mn_admin/mn_analytics_new/chart_directive/mn_analytics_chart_directive.html',
      scope: {
        stats: "=",
        id: "@",
        blockName: "@",
        nodes: "=",
        height: "="
      },
      controller: controller
    };

    function controller($scope) {
      var breakInterval;
      var poller;

      $scope.editChart = editChart;
      $scope.selectedZoom = "minute";
      $scope.selectedHost = $scope.nodes.nodesNames[0];
      $scope.onParamsChange = onParamsChange;

      $scope.options = {
        chart: {
          type: 'lineChart',
          height: Number($scope.height),
          margin : {
            top: 20,
            right: 20,
            bottom: 40,
            left: 55
          },
          defined: function (item, index) {
            if (!$scope.chartData) {
              return
            }
            var prev = $scope.chartData[item.series].values[index - 1];
            console.log(item[0],  (prev && prev[0] + breakInterval), prev && prev[0])
            if (prev) {
              if (item[0] > (prev[0] + breakInterval)) {
                return false;
              }
            }
            return true;
          },
          x: function (d) {
            return d[0] || 0;
          },
          y: function (d) {
            return d[1] || 0;
          },
          useInteractiveGuideline: true,
          transitionDuration: 1,
          xAxis: {
            axisLabel: 'Time (ms)'
          },
          xAxis: {
            tickFormat: function (d) {
              return d3.time.format('%H:%M:%S')(new Date(d));
            }
          }
        }
      };

      if ($scope.stats.length) {
        activate();
      }

      function editChart(id) {
        $uibModal.open({
          templateUrl: 'app/mn_admin/mn_analytics_new/chart_builder/mn_analytics_chart_builder.html',
          controller: 'mnAnalyticsNewChartBuilderController as chartBuilderCtl',
          resolve: {
            bucketName: function () {
              return $state.params.analyticsBucket;
            },
            blockName: function () {
              return $scope.blockName;
            },
            chart: function () {
              return  _.find(mnAnalyticsNewService.export.charts[$scope.blockName], function (chart) {
                return chart.id === Number(id);
              });
            }
          }
        });
      }

      function onParamsChange() {
        $scope.chartApi.refresh();
        $scope.chartData = [];
        delete poller.latestResult;
        $scope.$broadcast("reloadChartPoller");
      }

      function activate() {
        poller = new mnPoller($scope, function (previousResult) {
          return mnAnalyticsNewService.getBunchOfStats($scope.stats, $scope.selectedZoom, previousResult);
        })
          .setInterval(function (response) {
            return response[0].data.interval;
          })
          .subscribe(onPoller)
          .reloadOnScopeEvent("reloadChartPoller")
          .cycle();
      }
      function onPoller(stats) {
        breakInterval = stats[0].data.interval * 2.5 || 1e+20;
        if ($scope.chartData && $scope.chartData.length) {
          angular.forEach(stats, function (stat, index) {
            $scope.chartData[index].values.shift();
            $scope.chartData[index].values.push([
              stat.data.timestamp[stat.data.timestamp.length -1],
              stat.data.nodeStats[$scope.selectedHost][stat.data.nodeStats[$scope.selectedHost].length -1],
            ]);
          });
        } else {
          var chartData = [];
          angular.forEach(stats, function (stat, index) {
            chartData.push({
              key: $scope.stats[index].title,
              values: _.zip(stat.data.timestamp, _.flattenDeep(stat.data.nodeStats[$scope.selectedHost]))
            });
          });
          $scope.currentStats = stats;
          $scope.chartData = chartData;
        }
      }
    }
  }
})();
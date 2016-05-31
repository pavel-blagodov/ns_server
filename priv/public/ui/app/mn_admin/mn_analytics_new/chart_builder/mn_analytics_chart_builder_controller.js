(function () {
  "use strict";

  angular
    .module("mnAnalyticsNew")
    .controller("mnAnalyticsNewChartBuilderController", mnAnalyticsNewChartBuilderController);

  function mnAnalyticsNewChartBuilderController(mnPromiseHelper, mnBucketsStats, mnAnalyticsNewService, bucketName, blockName, chart) {
    var vm = this;

    vm.create = create;

    vm.newChart = _.clone(chart, true) || {
      stats: [],
      size: "450"
    };

    activate();

    function activate() {
      var url = "/pools/default/buckets//" + bucketName + "/statsDirectory?addi=%22all%22&addq=1";
      mnPromiseHelper(vm, mnAnalyticsNewService.getStatsDirectory(url))
        .applyToScope(function (resp) {
          vm.statsDirectoryBlock = _.find(resp.data.blocks, function (block) {
            return block.blockName === blockName;
          });
        })
        .showSpinner();
    }

    function create() {
      var charts = JSON.parse(localStorage.getItem('mnAnalyticsNewCharts')) || {};

      if (vm.newChart.id) {
        var index = _.findIndex(['id', vm.newChart.id]);
        charts[blockName][index] = {
          stats: _.compact(vm.newChart.stats),
          size: vm.newChart.size,
          id: vm.newChart.id
        };
      } else {
        var chartId = new Date().getTime();
        charts[blockName] = charts[blockName] || [];
        charts[blockName].push({
          stats: _.compact(vm.newChart.stats),
          size: vm.newChart.size,
          id: chartId
        });
      }

      mnAnalyticsNewService.export.charts = charts;
      localStorage.setItem('mnAnalyticsNewCharts', JSON.stringify(charts));
    }
 
  }
})();

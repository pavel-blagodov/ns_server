(function () {
  "use strict";

  angular
    .module("mnAnalyticsNew")
    .controller("mnAnalyticsNewChartBuilderController", mnAnalyticsNewChartBuilderController);

  function mnAnalyticsNewChartBuilderController(mnPromiseHelper, mnBucketsStats, mnAnalyticsNewService, bucketName, blockName) {
    var vm = this;

    vm.create = create;

    vm.newChart = {
      stats: []
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
      var chartsByBlock = JSON.parse(localStorage.getItem('mnAnalyticsNewCharts')) || {};
      var chartId = new Date().getTime();
      chartsByBlock[blockName] = chartsByBlock[blockName] || {};
      chartsByBlock[blockName][chartId] = _.compact(vm.newChart.stats);
      mnAnalyticsNewService.export.chartsByBlock = chartsByBlock;
      localStorage.setItem('mnAnalyticsNewCharts', JSON.stringify(chartsByBlock));
    }
 
  }
})();

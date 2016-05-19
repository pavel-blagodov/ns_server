(function () {
  "use strict";

  angular
    .module("mnAnalyticsNew")
    .controller("mnAnalyticsNewChartBuilderController", mnAnalyticsNewChartBuilderController);

  function mnAnalyticsNewChartBuilderController(mnPromiseHelper, mnBucketsStats, mnAnalyticsNewService) {
    var vm = this;

    vm.selectBucket = selectBucket;
    vm.create = create;

    vm.newChart = {
      bucket: "",
      block: {}
    };

    activate();

    function selectBucket() {
      var url = "/pools/default/buckets//" + vm.newChart.bucket + "/statsDirectory?addi=%22all%22&addq=1";
      mnPromiseHelper(vm, mnAnalyticsNewService.getStatsDirectory(url))
        .applyToScope(function (resp) {
          vm.statsDirectoryBlocks = resp.data.blocks;
        })
        .showSpinner();
    }

    function create() {
      var chartsByBlock = JSON.parse(localStorage.getItem('mnAnalyticsNewCharts')) || {};
      var chartId = new Date().getTime();
      angular.forEach(vm.newChart.block, function (stats, blockName) {
        if (!stats) {
          return;
        }
        chartsByBlock[blockName] = chartsByBlock[blockName] || {};
        chartsByBlock[blockName][chartId] = _.compact(stats);
      });
      mnAnalyticsNewService.export.chartsByBlock = chartsByBlock;
      localStorage.setItem('mnAnalyticsNewCharts', JSON.stringify(chartsByBlock));
    }

    function activate() {
      mnPromiseHelper(vm, mnBucketsStats.get())
        .applyToScope(function (buckets) {
          console.log()
          vm.buckets = buckets.data;
        })
        .showSpinner();
    }
  }
})();

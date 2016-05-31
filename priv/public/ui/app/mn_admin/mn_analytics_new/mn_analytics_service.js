(function () {
  "use strict";

  angular
    .module('mnAnalyticsNewService', ["mnServersService"])
    .factory('mnAnalyticsNewService', mnAnalyticsNewServiceFactory);

  function mnAnalyticsNewServiceFactory($http, $q, mnServersService) {
    var mnAnalyticsNewService = {
      prepareNodesList: prepareNodesList,
      getStatsDirectory: getStatsDirectory,
      getBunchOfStats: getBunchOfStats,
      export: {
        charts: JSON.parse(localStorage.getItem('mnAnalyticsNewCharts')) || {}
      }
    };

    return mnAnalyticsNewService;

    function prepareNodesList(params) {
      return mnServersService.getNodes().then(function (nodes) {
        var rv = {};
        rv.nodesNames = _(nodes.active).filter(function (node) {
          return !(node.clusterMembership === 'inactiveFailed') && !(node.status === 'unhealthy');
        }).pluck("hostname").value();
        // rv.nodesNames.unshift("All Server Nodes (" + rv.nodesNames.length + ")");
        rv.nodesNames.selected = params.statsHostname || rv.nodesNames[0];
        return rv;
      });
    }

    function getBunchOfStats(stats, zoom, prev) {
      var querise = [];
      
      angular.forEach(stats, function (stat, statName) {
        querise.push($http({
          method: "GET",
          url: stat.specificStatsURL,
          params: {
            resampleForUI: true, 
            zoom: zoom,
            haveTStamp: prev && prev[0].data.lastTStamp
          }
        }))
      });
      return $q.all(querise).then(function (resp) {
        return _.map(resp, function (resp, index) {
          resp.statDescription = stats[index];
          return resp;
        });
      });
    }

    function getStatsDirectory(url) {
      return $http({
        url: url,
        method: 'GET'
      });
    }
  }
})();

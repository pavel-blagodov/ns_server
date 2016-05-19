(function () {
  "use strict";

  angular
    .module('mnNav', [])
    .directive('mnNav', mnNavigationDirective);

    function mnNavigationDirective() {
      var directive = {
        restrict: 'AE',
        replace: true,
        templateUrl: 'app/components/directives/mn_nav/mn_nav.html'
      };

      return directive;
    }
})();

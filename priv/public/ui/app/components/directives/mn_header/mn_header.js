(function () {
  "use strict";

  angular
    .module('mnHeader', [])
    .directive('mnHeader', mnHeaderDirective);

    function mnHeaderDirective() {
      var directive = {
        restrict: 'AE',
        replace: true,
        transclude: {
          mnBreadcrumb: "mnBreadcrumb",
          mnControls: "?mnControls"
        },
        templateUrl: 'app/components/directives/mn_header/mn_header.html'
      };

      return directive;
    }
})();

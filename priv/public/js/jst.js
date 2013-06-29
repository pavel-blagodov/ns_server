var jst = (function () {

  return {
    analyticsRightArrow: function (aInner, params) {
      var a = $('<a>' + aInner + '</a>')[0];
      a.setAttribute('href', '#' + $.param(params));
      var li = document.createElement('LI');
      li.appendChild(a);

      return li;
    },
    serverActions: function (n) {
      return '<span class="usage_info">' + escapeHTML(n.percent) + '% Complete</span><span class="server_usage"><span style="width: ' + escapeHTML(n.percent) + '%;"></span></span>'
    }
  };
})();
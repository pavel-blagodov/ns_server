var jst = (function () {

  return {
    virtualTag: $("<div />"),
    analyticsRightArrow: function (aInner, params) {
      var a = $('<a>' + aInner + '</a>')[0];
      a.setAttribute('href', '#' + $.param(params));
      var li = document.createElement('LI');
      li.appendChild(a);

      return li;
    },
    serverActions: function (n) {
      return '<span class="usage_info">' + escapeHTML(n.percent) + '% Complete</span><span class="server_usage"><span style="width: ' + escapeHTML(n.percent) + '%;"></span></span>'
    },
    serverBar: function (width, value) {
      var wrap = $("<div />").addClass("in_precents");
      var inner = $("<span />");
      var span = $("<i />").css({"width": width + "%"});
      var textWrap = $("<u />").text(value > 0 || isFinite(value) ? ViewHelpers.formatMemSize(value) : "N/A");

      wrap.append(inner.append(span), textWrap);

      return this.virtualTag.html(wrap).html();
    },
  };
})();
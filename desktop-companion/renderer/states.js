// 校了么桌面伴侣 · 展示状态配置与轮播纯逻辑（可被 Node 测试 require）
// 数量由书稿数据（manuscripts.js）统计得到，本文件只负责状态与轮播。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.companionStates = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // 轮播顺序固定：发生滞留 → 正在配送 → 正在校对 → 在排队
  var CAROUSEL_ORDER = ["overdue", "delivering", "proofreading", "queued"];

  var STATES = {
    overdue: { id: "overdue", label: "发生滞留", priority: 1 },
    delivering: { id: "delivering", label: "正在配送", priority: 2 },
    proofreading: { id: "proofreading", label: "正在校对", priority: 3 },
    queued: { id: "queued", label: "在排队", priority: 4 },
  };

  function statesInCarouselOrder() {
    return CAROUSEL_ORDER.map(function (id) {
      return STATES[id];
    });
  }

  // 数量不为 0 的状态（counts: { [status]: number }）。
  function filterActiveStates(list, counts) {
    return list.filter(function (s) {
      return (counts && counts[s.id] ? counts[s.id] : 0) > 0;
    });
  }

  function activeCarouselStates(counts) {
    return filterActiveStates(statesInCarouselOrder(), counts);
  }

  function highestPriorityState(counts) {
    var active = activeCarouselStates(counts);
    if (active.length === 0) return null;
    return active.reduce(function (best, s) {
      return s.priority < best.priority ? s : best;
    });
  }

  function nextStateId(currentId, counts) {
    var active = activeCarouselStates(counts);
    if (active.length === 0) return null;
    var idx = -1;
    for (var i = 0; i < active.length; i++) {
      if (active[i].id === currentId) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return active[0].id;
    return active[(idx + 1) % active.length].id;
  }

  return {
    CAROUSEL_ORDER: CAROUSEL_ORDER,
    STATES: STATES,
    statesInCarouselOrder: statesInCarouselOrder,
    filterActiveStates: filterActiveStates,
    activeCarouselStates: activeCarouselStates,
    highestPriorityState: highestPriorityState,
    nextStateId: nextStateId,
  };
});

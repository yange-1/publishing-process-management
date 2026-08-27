// 校了么桌面伴侣 · 书稿状态与语音变化逻辑（纯逻辑，主进程与测试共用）
// 状态字段统一为 state（overdue/delivering/proofreading/queued）。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.companionManuscripts = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // 内部模拟数据（仅测试/开发模式，正常运行不使用）。
  var MOCK_MANUSCRIPTS = [
    { manuscriptId: "M01", title: "书稿1", state: "proofreading" },
    { manuscriptId: "M02", title: "书稿2", state: "proofreading" },
    { manuscriptId: "M03", title: "书稿3", state: "proofreading" },
    { manuscriptId: "M04", title: "书稿4", state: "overdue" },
    { manuscriptId: "M05", title: "书稿5", state: "overdue" },
    { manuscriptId: "M06", title: "书稿6", state: "delivering" },
    { manuscriptId: "M07", title: "书稿7", state: "delivering" },
    { manuscriptId: "M08", title: "书稿8", state: "delivering" },
    { manuscriptId: "M09", title: "书稿9", state: "queued" },
    { manuscriptId: "M10", title: "书稿10", state: "queued" },
    { manuscriptId: "M11", title: "书稿11", state: "queued" },
    { manuscriptId: "M12", title: "书稿12", state: "queued" },
  ];

  // 统计各状态数量。
  function countByState(manuscripts) {
    var counts = {};
    manuscripts.forEach(function (m) {
      counts[m.state] = (counts[m.state] || 0) + 1;
    });
    return counts;
  }

  // 状态变化播报短语（沿用已确认文案）。
  function stateVerb(state) {
    switch (state) {
      case "proofreading":
        return "已开始校对。";
      case "overdue":
        return "发生滞留，请及时处理。";
      case "delivering":
        return "正在配送。";
      case "queued":
        return "已进入排队。";
      default:
        return "";
    }
  }

  // 当前书稿列表转快照：{ [manuscriptId]: state }。
  function toSnapshot(manuscripts) {
    var snap = {};
    manuscripts.forEach(function (m) {
      snap[m.manuscriptId] = m.state;
    });
    return snap;
  }

  // 检测状态变化：prevSnapshot 为 null 表示首次（不返回变化）；
  // 新出现或状态改变的书稿都算变化。
  function detectChanges(prevSnapshot, current) {
    if (!prevSnapshot) return [];
    var changes = [];
    current.forEach(function (m) {
      var prev = prevSnapshot[m.manuscriptId];
      if (prev === undefined || prev !== m.state) {
        changes.push({
          manuscriptId: m.manuscriptId,
          title: m.title,
          previousStatus: prev === undefined ? null : prev,
          currentStatus: m.state,
        });
      }
    });
    return changes;
  }

  // 合并数量：同一状态多本书合并为一句，避免重复朗读同一句。
  function changesSpeech(changes) {
    var counts = {};
    changes.forEach(function (c) {
      counts[c.currentStatus] = (counts[c.currentStatus] || 0) + 1;
    });
    var order = ["overdue", "delivering", "proofreading", "queued", "delivered"];
    var speech = "";
    order.forEach(function (state) {
      var n = counts[state];
      if (!n) return;
      if (state === "delivered") {
        // 已送达专用文案：单份 / 多份合并
        speech += n === 1 ? "您好，您的书稿已送达。" : "您好，您有" + n + "份书稿已送达。";
      } else {
        speech += "您有" + n + "份书稿" + stateVerb(state);
      }
    });
    return speech;
  }

  return {
    MOCK_MANUSCRIPTS: MOCK_MANUSCRIPTS,
    countByState: countByState,
    stateVerb: stateVerb,
    toSnapshot: toSnapshot,
    detectChanges: detectChanges,
    changesSpeech: changesSpeech,
  };
});

// 校了么桌面伴侣 · 渲染逻辑（完全透明悬浮动图）
// 显示主进程推送的多状态动图轮播；语音仅在真实状态变化时由主进程下发。
(function () {
  "use strict";

  var ILLUSTRATIONS = {
    proofreading: function () {
      return (
        '<div class="lv">' +
        '<img class="ly ly-book" src="assets/proofreading-book.png" alt="" />' +
        '<img class="ly ly-hand anim-write" src="assets/proofreading-hand-pen.png" alt="" />' +
        "</div>"
      );
    },
    overdue: function () {
      return (
        '<div class="lv">' +
        '<img class="ly ly-stalled-books" src="assets/stalled-books.png" alt="" />' +
        '<img class="ly ly-stalled-exclaim anim-exclaim" src="assets/stalled-exclamation.png" alt="" />' +
        "</div>"
      );
    },
    delivering: function () {
      return (
        '<div class="lv">' +
        '<img class="ly ly-wings anim-flap" src="assets/delivery-wings.png" alt="" />' +
        '<img class="ly ly-delivery-books anim-float" src="assets/delivery-books.png" alt="" />' +
        "</div>"
      );
    },
    queued: function () {
      return (
        '<div class="lv">' +
        '<img class="ly ly-queue-books anim-breathe" src="assets/queue-books.png" alt="" />' +
        "</div>"
      );
    },
    // 空状态：已成功返回数据但四种数量均为零，显示静态书堆（无动画）。
    empty: function () {
      return (
        '<div class="lv">' +
        '<img class="ly ly-queue-books" src="assets/queue-books.png" alt="" />' +
        "</div>"
      );
    },
  };

  var stage = document.getElementById("stage");
  var muted = false;
  var carouselStates = [];
  var carouselIndex = 0;
  var carouselTimer = null;
  // 数字键 → 状态（仅开发验收，切换动图，不触发语音）
  var KEY_TO_STATE = { "1": "proofreading", "2": "overdue", "3": "delivering", "4": "queued" };

  function renderState(stateId) {
    if (ILLUSTRATIONS[stateId]) stage.innerHTML = ILLUSTRATIONS[stateId]();
  }

  function renderCurrent() {
    if (carouselStates.length === 0) return;
    renderState(carouselStates[carouselIndex]);
  }

  function stopCarousel() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  function startCarousel() {
    stopCarousel();
    carouselTimer = setInterval(function () {
      if (carouselStates.length <= 1) return; // 单一状态不切换
      carouselIndex = (carouselIndex + 1) % carouselStates.length;
      renderCurrent();
    }, 5000);
  }

  // 更新轮播队列：只轮播数量大于 0 的动画状态；空则显示静态书堆。
  function updateStates(states) {
    if (!Array.isArray(states)) return;
    if (states.length === 0 || (states.length === 1 && states[0] === "empty")) {
      carouselStates = [];
      carouselIndex = 0;
      stopCarousel();
      renderState("empty");
      return;
    }
    var next = states.filter(function (s) {
      return !!ILLUSTRATIONS[s] && s !== "empty";
    });
    if (next.length === 0) {
      carouselStates = [];
      carouselIndex = 0;
      stopCarousel();
      renderState("empty");
      return;
    }
    carouselStates = next;
    if (carouselIndex >= carouselStates.length) carouselIndex = 0;
    renderCurrent();
    startCarousel();
  }

  function speak(text) {
    if (!text || muted) return;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel(); // 新播报前取消旧语音
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    var voices = window.speechSynthesis.getVoices();
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang && voices[i].lang.toLowerCase().indexOf("zh") === 0) {
        u.voice = voices[i];
        break;
      }
    }
    window.speechSynthesis.speak(u);
  }

  function init() {
    // 启动阶段不显示任何图形，保持完全透明，等待主进程推送真实状态。
    if (window.companion) {
      if (typeof window.companion.getMuted === "function") {
        window.companion.getMuted().then(function (m) {
          muted = !!m;
        });
      }
      if (typeof window.companion.onMuteChanged === "function") {
        window.companion.onMuteChanged(function (m) {
          muted = !!m;
          if (muted && "speechSynthesis" in window) window.speechSynthesis.cancel();
        });
      }
      if (typeof window.companion.onData === "function") {
        window.companion.onData(function (payload) {
          if (!payload) return;
          if (payload.voiceText) speak(payload.voiceText);
          if (payload.states) updateStates(payload.states);
        });
      }
    }

    document.addEventListener("keydown", function (e) {
      var stateId = KEY_TO_STATE[e.key];
      if (stateId) renderState(stateId);
    });
  }

  init();
})();

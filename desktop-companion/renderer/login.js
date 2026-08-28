// 校了么桌面伴侣 · 登录小窗口
// 只负责提交用户名、密码与平台地址给主进程，不保存密码、不接触令牌与网络。
(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var serverUrl = document.getElementById("server-url");
  var username = document.getElementById("username");
  var password = document.getElementById("password");
  var error = document.getElementById("error");
  var submitBtn = document.getElementById("submit");

  // 预填当前平台地址
  if (window.companionLogin && typeof window.companionLogin.getServerUrl === "function") {
    Promise.resolve(window.companionLogin.getServerUrl()).then(function (url) {
      if (url) serverUrl.value = url;
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    error.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "登录中…";

    var p = window.companionLogin.submit(username.value, password.value, serverUrl.value);
    Promise.resolve(p)
      .then(function (result) {
        if (result && result.ok) {
          return; // 成功：主进程会关闭本窗口
        }
        error.textContent = (result && result.message) || "登录失败";
      })
      .catch(function () {
        error.textContent = "无法连接服务";
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "登录";
      });
  });
})();

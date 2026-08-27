// 校了么桌面伴侣 · 登录小窗口
// 只负责提交用户名密码给主进程，不保存密码、不接触令牌与网络。
(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var username = document.getElementById("username");
  var password = document.getElementById("password");
  var error = document.getElementById("error");
  var submitBtn = document.getElementById("submit");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    error.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "登录中…";

    var p = window.companionLogin.submit(username.value, password.value);
    Promise.resolve(p)
      .then(function (result) {
        if (result && result.ok) {
          // 成功：主进程会关闭本窗口
          return;
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

/**
 * 统一 HTTP 客户端。
 *
 * 契约（全站唯一）：
 *   - **永不 throw**。任何失败都返回 { ok:false, status, data:null, error }，
 *     由调用方决定渲染 error 态还是 empty 态。旧实现把 fetch 包在 try/catch 里、
 *     失败就静默退回写死的"正常"数值，是本项目最严重的一类假数据来源。
 *   - **竞态守卫**：以「路径」为键，同一路径的新请求会 abort 掉尚未返回的旧请求，
 *     旧请求以 { aborted:true } 返回，调用方直接丢弃，避免快速切县时旧响应覆盖新值。
 *   - **超时**：默认 8s；完整拟合类接口（PU / NPP benchmark）传 60s。
 */
(function (MR) {
  "use strict";

  var inflight = Object.create(null);

  /**
   * 用 file:// 直接双击 index.html 打开时，相对路径 "/api/..." 会被解析成
   * "file:///api/..."，请求 100% 失败——页面会老老实实渲染成一片错误态
   * （这符合零伪造原则，但需要给使用者清晰的状态反馈）。
   * 这里在这种情形下显式指回本机后端；用 http(s) 打开时 BASE 为空字符串，
   * 行为与改动前完全一致。端口可用 window.MR_API_BASE 覆盖。
   */
  var BASE = "";
  try {
    if (window.location && window.location.protocol === "file:") {
      BASE = window.MR_API_BASE || "http://127.0.0.1:8001";
    }
  } catch (e) {
    /* 取不到 location 就按相对路径处理 */
  }

  function abs(url) {
    return BASE && String(url).charAt(0) === "/" ? BASE + url : url;
  }

  function request(key, url, init, timeout) {
    // 同键旧请求作废
    if (inflight[key]) {
      try {
        inflight[key].abort();
      } catch (e) {
        /* 忽略：abort 失败不影响新请求 */
      }
    }
    var ctrl = new AbortController();
    inflight[key] = ctrl;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      try {
        ctrl.abort();
      } catch (e) {
        /* 忽略 */
      }
    }, timeout);

    var opts = { method: init.method || "GET" };
    if (init.headers) opts.headers = init.headers;
    if (init.body !== undefined) opts.body = init.body;
    opts.signal = ctrl.signal;

    return fetch(abs(url), opts)
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (!res.ok) {
              return {
                ok: false,
                status: res.status,
                data: data,
                error: "HTTP " + res.status,
                aborted: false,
              };
            }
            return { ok: true, status: res.status, data: data, error: null, aborted: false };
          });
      })
      .catch(function (err) {
        var isAbort = err && err.name === "AbortError";
        return {
          ok: false,
          status: 0,
          data: null,
          error: isAbort
            ? timedOut
              ? "请求超时（" + Math.round(timeout / 1000) + "s）"
              : "已被更新的请求取代"
            : String((err && err.message) || err),
          aborted: isAbort && !timedOut,
        };
      })
      .then(function (result) {
        clearTimeout(timer);
        if (inflight[key] === ctrl) delete inflight[key];
        return result;
      });
  }

  MR.api = {
    /** GET，默认 8s 超时 */
    get: function (url, opts) {
      return request(url, url, opts || {}, (opts && opts.timeout) || 8000);
    },
    /** POST JSON，默认 8s 超时 */
    post: function (url, body, opts) {
      var o = opts || {};
      return request(
        url,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        },
        o.timeout || 8000
      );
    },
  };
})(window.MR);

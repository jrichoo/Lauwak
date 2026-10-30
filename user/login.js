// Login / sign-up page: talks to /api/auth/* on the Lauwak server.
(function () {
  const $ = (id) => document.getElementById(id);
  const next = (() => {
    const n = new URLSearchParams(location.search).get("next") || "/";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/";
  })();

  // Already logged in? Go straight to the app.
  fetch("/api/auth/me/", { credentials: "same-origin" })
    .then((r) => r.ok && location.replace(next))
    .catch(() => {});

  const front = document.querySelector(".face.front");
  const back = document.querySelector(".face.back");
  const card = $("card");

  // Each face holds two steps; only one is visible, so the flip never mirrors a
  // panel and a hidden step can never swallow the Enter key.

  function showStep(face, paneId) {
    face.querySelectorAll(".pane").forEach((p) => {
      const show = p.id === paneId;
      if (!show) stopClock(p.id);
      p.hidden = !show;
    });
  }

  function toLogin() {
    // The code pane is on the other face, so showStep never sees it being hidden:
    // a code you walked away from would keep counting down in the background.
    stopClock("verifyPane");
    card.classList.remove("flipped");
    showStep(front, "loginPane");
  }

  function toVerify(email) {
    $("verifyAddr").textContent = email;
    showStep(back, "verifyPane");
    card.classList.add("flipped");
    $("verifyCode").focus();
  }

  // A mistyped address or name is fixed at the form, not in front of a code that
  // can never arrive. The typed values stay where they are to be corrected, and no
  // account exists yet, so pressing Sign up simply replaces the waiting details.
  function toSignup() {
    showStep(back, "signupPane");
    card.classList.add("flipped");
    setMsg($("verifyMsg"), "", false);
    $("signupName").focus();
  }

  function setMsg(el, text, ok) {
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }

  // ---------- the countdown under a mailed code ----------
  const clocks = {};
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  function stopClock(paneId) {
    if (clocks[paneId]) clearInterval(clocks[paneId]);
    delete clocks[paneId];
  }

  // The server answers with the seconds it actually allowed, so the page counts
  // real deadlines instead of assuming the code arrived the instant it was sent.
  function armClock(paneId, timerEl, btn, seconds, waitSeconds) {
    stopClock(paneId);
    if (!seconds) {
      timerEl.textContent = "";
      return;
    }
    const expiresAt = Date.now() + seconds * 1000;
    const resendAt = Date.now() + (waitSeconds || 0) * 1000;
    function paint() {
      const left = Math.ceil((expiresAt - Date.now()) / 1000);
      const wait = Math.ceil((resendAt - Date.now()) / 1000);
      if (left <= 0) {
        timerEl.textContent = "This code expired. Ask for a new one.";
        timerEl.classList.add("warn");
        btn.disabled = false;
        btn.textContent = "Send a new code";
        return;
      }
      timerEl.classList.remove("warn");
      timerEl.textContent = `Expires in ${fmt(left)}`;
      btn.disabled = wait > 0;
      btn.textContent =
        wait > 0 ? `New code in ${fmt(wait)}` : "Send a new code";
    }
    paint();
    clocks[paneId] = setInterval(paint, 1000);
  }

  // A code the server could not mail has no clock worth starting; the button has
  // to stay live so the visitor can ask again.
  function armIfSent(paneId, timerEl, btn, data) {
    if (!data.sent) {
      stopClock(paneId);
      timerEl.textContent = "";
      btn.disabled = false;
      return;
    }
    armClock(paneId, timerEl, btn, data.expires_in, data.resend_in);
  }

  async function apiPost(kind, body) {
    // The trailing slash is required: Django redirects slash-less URLs with 301,
    // and fetch drops the body and the POST method when it follows one.
    const r = await fetch("/api/auth/" + kind + "/", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }

  // The page's five flows are all the same three steps: grey the button out, ask
  // the server, then either act on the answer or print the reason it failed.
  // `done` gets the status code and JSON body; returning true means the page is
  // already navigating away, so the button stays disabled on purpose.
  async function call(kind, body, btn, msgEl, done) {
    setMsg(msgEl, "", false);
    btn.disabled = true;
    let leave = false;
    try {
      const { status, data } = await apiPost(kind, body);
      btn.disabled = false; // `done` may switch it back off for a cooldown
      if (status >= 400) {
        if (status === 403 && data.unverified) toVerify(body.email);
        throw new Error(data.error || "Something went wrong.");
      }
      leave = await done(status, data);
    } catch (e) {
      setMsg(
        msgEl,
        e instanceof TypeError
          ? "Can't reach the server. Is start.bat running?"
          : e.message,
        false,
      );
    }
    if (!leave) btn.disabled = false;
  }

  const value = (id) => $(id).value;

  // ---------- log in ----------
  function doLogin() {
    return call(
      "login",
      { email: value("loginEmail"), password: value("loginPassword") },
      $("loginBtn"),
      $("loginMsg"),
      () => {
        location.replace(next);
        return true;
      },
    );
  }

  // ---------- sign up ----------
  function doSignup() {
    return call(
      "signup",
      {
        name: value("signupName"),
        email: value("signupEmail"),
        password: value("signupPassword"),
      },
      $("signupBtn"),
      $("signupMsg"),
      (status, data) => {
        if (!data.verify_required) {
          location.replace(next);
          return true;
        }
        toVerify(data.email);
        armIfSent("verifyPane", $("verifyTimer"), $("resendBtn"), data);
        setMsg(
          $("verifyMsg"),
          data.sent
            ? "Check your inbox for the 6-digit code."
            : "We could not send the email. Press \u201cSend a new code\u201d.",
          data.sent,
        );
      },
    );
  }

  // ---------- confirm the emailed code ----------
  function doVerify() {
    return call(
      "verify",
      { email: $("verifyAddr").textContent, code: value("verifyCode") },
      $("verifyBtn"),
      $("verifyMsg"),
      () => {
        location.replace(next);
        return true;
      },
    );
  }

  // One resend flow, shared by the two code steps: same endpoint, and the server
  // decides which code that address is waiting on.
  function resendCode(paneId, btn, timerEl, msgEl, email) {
    return call("resend", { email }, btn, msgEl, (status, data) => {
      armIfSent(paneId, timerEl, btn, data);
      setMsg(
        msgEl,
        data.sent
          ? "A fresh code is on its way."
          : "We could not send it. Wait a moment and try again.",
        data.sent,
      );
    });
  }

  // ---------- forgot password: one button, two steps ----------
  let codeMailed = false;

  function resetStep(sent) {
    codeMailed = sent;
    $("resetCodeRow").hidden = !sent;
    $("resetPwRow").hidden = !sent;
    $("resetResendBtn").hidden = !sent;
    $("resetBtn").textContent = sent ? "Set new password" : "Send code";
    $("resetHint").textContent = sent
      ? "Type the 6-digit code and pick a new password."
      : "Enter your email and we'll send you a 6-digit code.";
    if (!sent) {
      stopClock("resetPane");
      $("resetTimer").textContent = "";
    }
  }

  function doForgot() {
    if (!codeMailed) {
      return call(
        "forgot",
        { email: value("resetEmail") },
        $("resetBtn"),
        $("resetMsg"),
        (status, data) => {
          resetStep(true);
          armIfSent("resetPane", $("resetTimer"), $("resetResendBtn"), data);
          // The server answers the same either way so accounts can't be looked up,
          // so this wording stays true for an address that has none.
          setMsg($("resetMsg"), "Sent", true);
          $("resetCode").focus();
        },
      );
    }
    return call(
      "reset",
      {
        email: value("resetEmail"),
        code: value("resetCode"),
        password: value("resetPassword"),
      },
      $("resetBtn"),
      $("resetMsg"),
      () => {
        location.replace(next);
        return true;
      },
    );
  }

  function resetBack() {
    toLogin();
    // That step is two screens on one button, so leaving it goes back to the first.
    resetStep(false);
    setMsg($("resetMsg"), "", false);
  }

  $("loginBtn").addEventListener("click", doLogin);
  $("signupBtn").addEventListener("click", doSignup);
  $("verifyBtn").addEventListener("click", doVerify);
  $("resendBtn").addEventListener("click", () =>
    resendCode(
      "verifyPane",
      $("resendBtn"),
      $("verifyTimer"),
      $("verifyMsg"),
      $("verifyAddr").textContent,
    ),
  );
  $("resetResendBtn").addEventListener("click", () =>
    resendCode(
      "resetPane",
      $("resetResendBtn"),
      $("resetTimer"),
      $("resetMsg"),
      value("resetEmail"),
    ),
  );
  $("resetBtn").addEventListener("click", doForgot);
  $("forgotBtn").addEventListener("click", () => {
    $("resetEmail").value = value("loginEmail");
    resetStep(false);
    showStep(front, "resetPane");
    setMsg($("resetMsg"), "", false);
    $("resetEmail").focus();
  });
  $("resetBackBtn").addEventListener("click", resetBack);
  // The flip links use the same steps as the buttons, so a face can never show the
  // form you left and the form you came back to at the same time.
  $("joinLink").addEventListener("click", toSignup);
  $("loginLink").addEventListener("click", toLogin);
  $("verifyBackBtn").addEventListener("click", () => {
    toLogin();
    // The wrong-password message belongs to the log in step, not the code step.
    setMsg($("loginMsg"), "", false);
  });
  $("verifyEditBtn").addEventListener("click", toSignup);

  // Codes are six digits, so a stray space or letter never reaches the server.
  ["resetCode", "verifyCode"].forEach((id) =>
    $(id).addEventListener(
      "input",
      () => ($(id).value = value(id).replace(/\D/g, "")),
    ),
  );

  front.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("loginPane").hidden ? doForgot : doLogin)();
  });
  back.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("signupPane").hidden ? doVerify : doSignup)();
  });
})();

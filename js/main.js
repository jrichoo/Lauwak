document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => app.showSection(btn.dataset.section));
});

document.addEventListener("DOMContentLoaded", () => app.init());

const myGif = document.getElementById("my-mascot");

function keepGifRunning() {
  const baseSrc = myGif.src.split("?")[0];
  myGif.src = baseSrc + "?t=" + new Date().getTime();
}

function showReset() {
  document.getElementById("resetModal").classList.add("active");
}

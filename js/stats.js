Object.assign(app, {
  updateStats() {
    const total = this.flashcards.length;
    const mastered = this.flashcards.filter((c) => c.mastery >= 3).length;
    const learning = this.flashcards.filter((c) => c.mastery === 1).length;
    const review = this.flashcards.filter((c) => c.mastery === 2).length;
    const newCards = this.flashcards.filter(
      (c) => !c.mastery || c.mastery === 0,
    ).length;

    document.getElementById("statNew").textContent = newCards;
    document.getElementById("statLearning").textContent = learning;
    document.getElementById("statReview").textContent = review;
    document.getElementById("statMastered").textContent = mastered;

    const bars = {
      statNewBar: newCards,
      statLearningBar: learning,
      statReviewBar: review,
      statMasteredBar: mastered,
    };
    for (const [id, value] of Object.entries(bars)) {
      document.getElementById(id).style.width =
        total > 0 ? `${(value / total) * 100}%` : "0%";
    }

    document.getElementById("statTotalReviews").textContent =
      this.stats.totalReviews;
    document.getElementById("statAccuracy").textContent =
      this.stats.totalReviews > 0
        ? `${Math.round((this.stats.correctAnswers / this.stats.totalReviews) * 100)}%`
        : "0%";

    const times = this.stats.responseTimes;
    const avg =
      times.length > 0
        ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000)
        : 0;
    document.getElementById("statAvgTime").textContent = `${avg}s`;
    document.getElementById("statPracticed").textContent =
      this.stats.codePracticed || 0;

    // Study history chart
    const chart = document.getElementById("studyChart");
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      days.push({
        label: d.toLocaleDateString("en", { weekday: "short" }),
        value: this.stats.studyHistory[key] || 0,
      });
    }

    const maxVal = Math.max(...days.map((d) => d.value), 1);
    chart.innerHTML = days
      .map(
        (d) => `
                    <div class="chart-bar" style="height: ${(d.value / maxVal) * 100}%;" title="${d.value} reviews">
                        <div class="chart-bar-label">${d.label}</div>
                    </div>
                `,
      )
      .join("");
  },
});

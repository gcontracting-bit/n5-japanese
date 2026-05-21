// Shared vocabulary mastery calculation.
//
// vocabulary.html is the only page with the full Genki word list (its tables),
// so it parses that list at runtime and publishes it to localStorage as
// `vocab_word_list` (an array of { kana, kanji:[], en, extra } objects).
// Any page can then compute the SAME word-level mastery the vocab page shows on
// its bar — live from the current vocab_scores — by calling VocabProgress.compute.
//
// Keep statusFromEntry + the worst-of loop here IDENTICAL to applyScores() in
// vocabulary.html so the dashboard wheel and the vocab bar can never disagree.
(function (global) {
  "use strict";

  // worst -> best
  var STATUS_RANK = { red: 0, amber: 1, untested: 2, green: 3 };

  function statusFromEntry(e) {
    if (!e) return 'untested';
    var st = e.state || null;
    if (!st && typeof e.streak === 'number') {
      if (e.streak >= 1) st = 'g';
      else if (e.streak === -1) st = 'a';
      else if (e.streak <= -2) st = 'r';
      else if (e.total > 0) st = 'r';
    }
    if (st === 'g') return 'green';
    if (st === 'a') return 'amber';
    if (st === 'r') return 'red';
    return 'untested';
  }

  // Each FORM (the kana form + every kanji form) is an independent item with
  // its own status. We do NOT merge a word's forms into a single status — this
  // mirrors the per-form logic in vocabulary.html applyScores() (and the
  // per-card model in flashcards.html), so the dashboard wheel, the vocab bar,
  // and the flashcards deck can never disagree. Extra-vocab words are excluded
  // from the totals, exactly like the vocab page's bar.
  // list item: { kana: string, kanji: string[], en: string, extra: boolean }
  function compute(list, scores) {
    var total = 0, mastered = 0;
    if (!Array.isArray(list)) return { mastered: 0, total: 0 };
    scores = scores || {};
    list.forEach(function (w) {
      if (!w || w.extra) return;
      var en = w.en;
      var forms = [w.kana].concat(w.kanji || []);
      forms.forEach(function (f) {
        total++;
        if (statusFromEntry(scores[f + '|' + en]) === 'green') mastered++;
      });
    });
    return { mastered: mastered, total: total };
  }

  global.VocabProgress = {
    STATUS_RANK: STATUS_RANK,
    statusFromEntry: statusFromEntry,
    compute: compute
  };
})(typeof window !== 'undefined' ? window : this);

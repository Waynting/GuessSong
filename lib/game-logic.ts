/**
 * Normalize answer text for comparison
 * - Convert to lowercase
 * - Remove punctuation and brackets
 * - Remove common words (feat., remix, version, etc.)
 */
export function normalizeAnswer(text: string): string {
  let normalized = text.toLowerCase().trim();

  // Remove common prefixes/suffixes
  const patternsToRemove = [
    /\s*\(feat\.\s*[^)]+\)/gi,
    /\s*\(ft\.\s*[^)]+\)/gi,
    /\s*feat\.\s*[^)]+/gi,
    /\s*ft\.\s*[^)]+/gi,
    /\s*\(remix\)/gi,
    /\s*\(version\)/gi,
    /\s*\(original\)/gi,
    /\s*\(extended\)/gi,
    /\s*\(radio edit\)/gi,
    /\s*\(explicit\)/gi,
    /\s*\(clean\)/gi,
  ];

  for (const pattern of patternsToRemove) {
    normalized = normalized.replace(pattern, "");
  }

  // Remove all punctuation except spaces
  normalized = normalized.replace(/[^\w\s]/g, " ");

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

/**
 * Check if player's answer matches the correct answer
 * Rules:
 * - If answer contains 3+ character keywords from song name, consider correct
 * - Or if answer contains full song name
 * - Also check artist name as fallback
 */
export function isAnswerCorrect(
  playerAnswer: string,
  correctSongName: string,
  correctArtists: string[]
): boolean {
  const normalizedPlayer = normalizeAnswer(playerAnswer);
  const normalizedSong = normalizeAnswer(correctSongName);
  const normalizedArtists = correctArtists.map(normalizeAnswer);

  // Check if player answer contains full song name
  if (normalizedPlayer.includes(normalizedSong) || normalizedSong.includes(normalizedPlayer)) {
    return true;
  }

  // Check if player answer contains any artist name
  for (const artist of normalizedArtists) {
    if (normalizedPlayer.includes(artist) || artist.includes(normalizedPlayer)) {
      // If artist match, also check if song name keywords are present
      const songWords = normalizedSong.split(" ").filter((w) => w.length >= 3);
      const matchingWords = songWords.filter((word) => normalizedPlayer.includes(word));
      if (matchingWords.length >= Math.min(2, songWords.length)) {
        return true;
      }
    }
  }

  // Check if answer contains significant keywords from song name (3+ chars)
  const songWords = normalizedSong.split(" ").filter((w) => w.length >= 3);
  if (songWords.length === 0) {
    // Very short song name, require exact match
    return normalizedPlayer === normalizedSong;
  }

  // Require at least 2 keywords or all keywords if song name is short
  const matchingWords = songWords.filter((word) => normalizedPlayer.includes(word));
  const requiredMatches = songWords.length <= 2 ? songWords.length : Math.ceil(songWords.length * 0.6);

  return matchingWords.length >= requiredMatches;
}

/**
 * Extract keywords from text (for debugging/logging)
 */
export function extractKeywords(text: string): string[] {
  const normalized = normalizeAnswer(text);
  return normalized.split(" ").filter((w) => w.length >= 3);
}


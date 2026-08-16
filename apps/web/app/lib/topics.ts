/**
 * The topics worth offering as filters, most used first, ties broken
 * alphabetically so the row does not reshuffle between two equal topics.
 */
export const topicsByFrequency = (documents: { topics: string[] }[], limit: number): string[] => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const topic of document.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts]
    .sort(([leftTopic, left], [rightTopic, right]) =>
      right === left ? leftTopic.localeCompare(rightTopic) : right - left,
    )
    .slice(0, limit)
    .map(([topic]) => topic);
};

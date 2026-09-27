export function resolveCommercialInsightSelection<T extends { id: string }>(
  allItems: T[],
  searchResults: T[],
  rankedItems: T[],
  selectedId: string | null,
  searchActive: boolean,
) {
  if (searchActive) {
    return searchResults.find((item) => item.id === selectedId)
      ?? searchResults[0]
      ?? null;
  }
  return allItems.find((item) => item.id === selectedId)
    ?? rankedItems[0]
    ?? allItems[0]
    ?? null;
}

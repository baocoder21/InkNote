// Runs once before every spec file (see "setupFiles" in angular.json).
//
// Unit tests run in jsdom, a simulated browser WITHOUT a layout engine. CodeMirror measures
// text positions with these Range methods, which jsdom does not implement, so we give it
// harmless "empty" versions. Real browsers are not affected: this file is only used by tests.
const emptyRectList = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
} as unknown as DOMRectList;

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => emptyRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

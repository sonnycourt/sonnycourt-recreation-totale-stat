// Static responsive variants: no image proxy or JavaScript needed in the browser.
export const deltaImageWidths = {
  'inspira-vsl-jungle-v2': [480, 800, 1200, 1672],
  'souffle-createur-theorie': [480, 800, 1200, 1672],
  'souffle-createur-seance': [480, 800, 1200, 1672],
  'delta-jungle-wrap-v2': [240, 480, 720, 933],
  'delta-jungle-canopy-v1': [240, 480, 800, 1200],
};
export const posterSizes = '(max-width: 760px) calc(100vw - 56px), (max-width: 1050px) calc(100vw - 120px), (max-width: 1144px) calc(100vw - 144px), 1000px';
export const foliageSizes = '(max-width: 760px) calc(40vw - 22.4px), (max-width: 1050px) calc(40vw - 48px), (max-width: 1144px) calc(40vw - 57.6px), 400px';
export const canopySizes = '(max-width: 760px) calc(42vw - 23.52px), (max-width: 1050px) calc(44vw - 52.8px), (max-width: 1144px) calc(44vw - 63.36px), 440px';
export const programSizes = '(max-width: 760px) calc(100vw - 42px), (max-width: 1050px) calc(50vw - 48px), (max-width: 1248px) calc(50vw - 60px), 564px';
export function responsiveDeltaImage(src, sizes) {
  const name = src.split('/').pop()?.replace(/\.webp$/, '');
  const widths = deltaImageWidths[name];
  if (!widths) return {};
  return {
    srcset: widths.map(width => `/media/pages/delta-responsive/${name}-${width}.webp ${width}w`).join(', '),
    sizes,
  };
}

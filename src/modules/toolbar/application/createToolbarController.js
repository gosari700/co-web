import { getToolbarFeature } from '../domain/toolbarFeatures.js';

export function createToolbarController({
  state,
  buttons,
  onStateChange,
  onUnsupportedFeature,
}) {
  function handleFeaturePress(featureId) {
    const feature = getToolbarFeature(featureId);
    if (!feature) {
      return;
    }

    if (!feature.implemented) {
      state.activeFeature = 'camera';
      onStateChange();
      onUnsupportedFeature(feature);
      return;
    }

    state.activeFeature = feature.id;
    onStateChange();
  }

  return {
    start() {
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          handleFeaturePress(button.dataset.feature);
        });
      });
    },
  };
}

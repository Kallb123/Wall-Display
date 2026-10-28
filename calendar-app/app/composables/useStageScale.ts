import { stageScale } from '~/utils/stage'

/** The scale that fits the 2560×1440 stage in the window, kept up to date as the window is resized. */
export function useStageScale(): Ref<number> {
  const scale = ref(stageScale(window.innerWidth, window.innerHeight))
  const update = () => {
    scale.value = stageScale(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', update)
  onScopeDispose(() => window.removeEventListener('resize', update))
  return scale
}

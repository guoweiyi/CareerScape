import { defineStore } from 'pinia'
export const usePreferences = defineStore('preferences', {
  state: () => ({ textOnly: false, lowData: false, reducedMotion: false, showAllText: true, galgameInstantText: false, galgameTextSpeed: 35, galgameAutoDelay: 5 }),
  actions: {
    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem('careerscape-preferences') || '{}')
        for (const key of ['textOnly', 'lowData', 'reducedMotion', 'showAllText', 'galgameInstantText'] as const)
          if (typeof saved[key] === 'boolean') this[key] = saved[key]
        if ([15, 35, 60].includes(saved.galgameTextSpeed)) this.galgameTextSpeed = saved.galgameTextSpeed
        if ([3, 5, 8, 12].includes(saved.galgameAutoDelay)) this.galgameAutoDelay = saved.galgameAutoDelay
      } catch {
        /* preferences are optional */
      }
    },
    save() {
      try { localStorage.setItem('careerscape-preferences', JSON.stringify(this.$state)) } catch { /* Optional preferences never block play. */ }
    },
  },
})

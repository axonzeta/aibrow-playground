import './index.scss'
import Logger from './Logger.js'
import AIResult from './AIResult.js'
import ModelDownload from './ModelDownload.js'
import Controls from './Controls.js'
import deepEqual from 'fast-deep-equal'
import Samples from './Samples.js'
import { AIBrowWeb } from '@aibrow/web'

let aiSession

for (const key of ['LanguageDetector', 'LanguageModel', 'Rewriter', 'Summarizer', 'Translator', 'Writer']) {
  Logger.logTask(`Checking for browser ${key}...`, (log) => {
    log(Boolean(window[key]) && window[key].aibrow !== true)
  })
}

Logger.logTask('Checking for window.aibrow...', async (log) => {
  const installed = !!window.aibrow && !!window.aibrow.LanguageModel // LanguageModel introduced in version 2.0.0+
  log(installed)

  if (!installed) {
    document.getElementById('not-installed').classList.remove('d-none')
  } else {
    const { helper } = await window.aibrow.capabilities()
    if (!helper) {
      document.getElementById('not-installed').classList.remove('d-none')
    }
  }
})

Logger.logTask('Checking for AiBrow (WebGPU)...', async (log) => {
  log((await AIBrowWeb.LanguageModel.availability({ gpuEngine: 'webgpu' })) === 'available')
})
Logger.logTask('Checking for AiBrow (Wasm)...', async (log) => {
  log((await AIBrowWeb.LanguageModel.availability({ gpuEngine: 'wasm' })) === 'available')
})


/* **************************************************************************/
// MARK: Utils
/* **************************************************************************/

/**
 * Gets the tool factory from the current tool & model
 * @return the tool factory
 */
function getToolFactory () {
  const tool = Controls.getTool()
  const toolKey = tool.charAt(0).toUpperCase() + tool.slice(1)
  const model = Controls.getModel()

  if (model === '__browser__') {
    return window[toolKey]
  } else if (model?.startsWith?.('__web__')) {
    return AIBrowWeb[toolKey]
  } else {
    return window.aibrow[toolKey]
  }
}

function getModelId () {
  const model = Controls.getModel()
  if (model === '__browser__') {
    return undefined // Browser doesn't support models
  } else if (model?.startsWith?.('__web__')) {
    return model.replace('__web__', '') || undefined // Remove the __web__ prefix
  } else {
    return model
  }
}

/* **************************************************************************/
// MARK: Capabilities
/* **************************************************************************/

/**
 * Updates the capabilities based on the current tool and model
 */
async function updateCapabilities () {
  const model = getModelId()
  const ToolFactory = getToolFactory()
  const tool = Controls.getTool()

  AIResult.clear()

  // Update the dom with default values and bounds
  if (ToolFactory?.compatibility) {
    Controls.enableModelOptions()
    const compatibility = await ToolFactory.compatibility({ model })
    Controls.replaceSelectOptions('gpu-engine', {
      '': 'Default',
      ...compatibility?.gpuEngines?.reduce?.((acc, v) => ({ ...acc, [v]: v }), {})
    }, '')
    const $contextSize = Controls.getField('context-size')
    const defaultContextSize = compatibility?.defaultContextSize ?? 1024
    const maxContextSize = compatibility?.maxContextSize ?? 2048
    $contextSize.value = defaultContextSize
    $contextSize.setAttribute('max', maxContextSize)
    Controls.setTooltip($contextSize, `${0} - ${maxContextSize}`)

    Controls.getField('flash-attention').checked = compatibility?.defaultFlashAttention ?? true
  } else {
    Controls.disableModelOptions()
    Controls.replaceSelectOptions('gpu-engine', {
      '': 'Default'
    }, '')
    Controls.getField('context-size').value = 0
  }

  switch (tool) {
    case 'languageModel': {
      const params = await ToolFactory.params({ model })

      const $topK = Controls.getField('top-k', tool)
      const defaultTopK = params.defaultTopK ?? 3
      const maxTopK = params.maxTopK ?? 8
      $topK.value = defaultTopK
      $topK.setAttribute('max', maxTopK)
      Controls.setTooltip($topK, `${0} - ${maxTopK}`)

      const $topP = Controls.getField('top-p', tool)
      const defaultTopP = params.defaultTopP ?? 0.9
      const maxTopP = params.maxTopP ?? 3
      $topP.value = defaultTopP
      $topP.setAttribute('max', maxTopP)
      Controls.setTooltip($topP, `${0} - ${maxTopP}`)

      const $temperature = Controls.getField('temperature', tool)
      const defaultTemperature = params.defaultTemperature ?? 0.5
      const maxTemperature = params.maxTemperature ?? 1
      $temperature.value = defaultTemperature
      $temperature.setAttribute('max', maxTemperature)
      Controls.setTooltip($temperature, `${0} - ${maxTemperature}`)

      const $repeatPenalty = Controls.getField('repeat-penalty', tool)
      const defaultRepeatPenalty = params.defaultRepeatPenalty ?? 1
      const maxRepeatPenalty = params.maxRepeatPenalty ?? 3
      $repeatPenalty.value = defaultRepeatPenalty
      $repeatPenalty.setAttribute('max', maxRepeatPenalty)
      Controls.setTooltip($repeatPenalty, `${0} - ${maxRepeatPenalty}`)
      break
    }
  }
}
Controls.onCapabilitiesChanged(updateCapabilities)
updateCapabilities()

/* **************************************************************************/
// MARK: UI Events
/* **************************************************************************/

/**
 * Handles the user clicking submit
 */
Controls.onSubmitClicked(async () => {
  const ToolFactory = getToolFactory()
  const tool = Controls.getTool()
  const model = getModelId()
  const modelData = Controls.getData()
  const toolData = Controls.getData(tool)

  // Build the create & prompt options
  const createOptions = {
    ...modelData,
    model
  }
  const promptOptions = {}

  switch (tool) {
    case 'languageModel': {
      Controls.clearError(Controls.getField('grammar', tool))
      if (toolData.grammar) {
        try {
          promptOptions.responseConstraint = JSON.parse(toolData.grammar)
        } catch (ex) {
          Controls.showError(Controls.getField('grammar', tool), 'Invalid JSON')
          return
        }
      }
      createOptions.topK = toolData.topK
      createOptions.topP = toolData.topP
      createOptions.repeatPenalty = toolData.repeatPenalty
      createOptions.temperature = toolData.temperature
      createOptions.initialPrompts = toolData.systemPrompt
        ? [{ role: 'system', content: toolData.systemPrompt }]
        : []
      break
    }
    case 'summarizer': {
      createOptions.type = toolData.type
      createOptions.format = toolData.format
      createOptions.length = toolData.length
      createOptions.sharedContext = toolData.context
      break
    }
    case 'rewriter':
    case 'writer': {
      createOptions.tone = toolData.tone
      createOptions.format = toolData.format
      createOptions.length = toolData.length
      createOptions.sharedContext = toolData.context
      break
    }
  }

  Controls.disable()

  try {
    // Add the user message
    AIResult.addMessage('User', toolData.input)

    // Check if the model is available
    Logger.logTask('Check model availability...', async (log) => {
      const availability = await ToolFactory.availability({ model })
      switch (availability) {
        case 'available':
          log(true)
          break
        case 'downloadable':
        case 'downloading':
          log('Download required')
          break
        case 'unavailable':
          log(false)
          break
      }
    })

    // Create the session
    if (aiSession?.session && deepEqual(aiSession.createOptions, createOptions)) {
      await Logger.logTask('Reusing session...', async (log) => log(true))
    } else {
      aiSession?.session?.destroy?.()
      aiSession = {
        createOptions,
        session: await Logger.logTask('Creating session...', async (log) => {
          log(createOptions)
          const res = await ModelDownload.createMonitor(async (monitor) => {
            return await ToolFactory.create({ ...createOptions, monitor })
          })
          log(true)
          return res
        })
      }
    }

    // Prompt the model
    const updateAssistantMessage = AIResult.addMessage('Assistant', '...')
    let stream
    switch (tool) {
      case 'languageModel': {
        stream = await Logger.logTask('Start streaming...', async (log) => {
          log(promptOptions)
          const stream = await aiSession.session.promptStreaming(toolData.input, promptOptions)
          log(true)
          return stream
        })
        break
      }
      case 'summarizer': {
        stream = await Logger.logTask('Start streaming...', async (log) => {
          log(promptOptions)
          const stream = await aiSession.session.summarizeStreaming(toolData.input, promptOptions)
          log(true)
          return stream
        })
        break
      }
      case 'rewriter': {
        stream = await Logger.logTask('Start streaming...', async (log) => {
          log(promptOptions)
          const stream = await aiSession.session.rewriteStreaming(toolData.input, promptOptions)
          log(true)
          return stream
        })
        break
      }
      case 'writer': {
        stream = await Logger.logTask('Start streaming...', async (log) => {
          log(promptOptions)
          const stream = await aiSession.session.writeStreaming(toolData.input, promptOptions)
          log(true)
          return stream
        })
        break
      }
    }

    let buffer = ''
    for await (const chunk of stream) {
      buffer += chunk
      updateAssistantMessage(buffer)
    }
  } finally {
    Controls.enable()
  }
})

Controls.onResetClicked(async () => {
  if (!window.confirm('Are you sure?')) { return }
  AIResult.clear()
  await Logger.logTask('Destroying session...', async (log) => {
    if (aiSession.session) {
      aiSession.session.destroy()
      aiSession.session = undefined
    }
    log(true)
  })
})

/* **************************************************************************/
// MARK: Samples
/* **************************************************************************/

for (const [key, config] of Object.entries(Samples)) {
  const $menu = document.querySelector(`[data-action="sample-${key}"]`)
  $menu.addEventListener('click', async (evt) => {
    evt.preventDefault()

    AIResult.clear()
    Controls.getField('tool').value = config.tool
    Controls.showTool(config.tool)
    await updateCapabilities()

    if (config.forms.model) {
      for (const [name, value] of Object.entries(config.forms.model)) {
        Controls.getField(name).value = value
      }
    }

    for (const [name, value] of Object.entries(config.forms.tool)) {
      Controls.getField(name, config.tool).value = value
    }
  })
}

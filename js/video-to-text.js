(function () {
  'use strict';

  var cameraPanel = document.querySelector('.camera-panel');
  var video = document.getElementById('camera-preview');
  var placeholder = document.getElementById('camera-placeholder');
  var startButton = document.getElementById('start-camera');
  var stopButton = document.getElementById('stop-camera');
  var cameraStatus = document.getElementById('camera-status');
  var languageSelect = document.getElementById('recognition-language');
  var transcript = document.getElementById('recognized-text');
  var confidence = document.getElementById('recognition-confidence');
  var dictionaryInput = document.getElementById('camera-dictionary-query');
  var dictionaryForm = document.getElementById('camera-dictionary-search');
  var dictionaryResults = document.getElementById('camera-dictionary-results');
  var sampleGloss = document.getElementById('sample-gloss');
  var sampleTranslation = document.getElementById('sample-translation');
  var sampleParticipant = document.getElementById('sample-participant');
  var sampleConsent = document.getElementById('sample-consent');
  var startSampleButton = document.getElementById('start-sample');
  var stopSampleButton = document.getElementById('stop-sample');
  var downloadAnnotationsButton = document.getElementById('download-annotations');
  var datasetStatus = document.getElementById('dataset-status');
  var stream;
  var sampleRecorder;
  var sampleChunks = [];
  var sampleStartedAt;
  var activeSampleLabels;
  var discardSampleWhenStopped = false;
  var collectedSamples = [];
  var recognitionTimer;
  var isRecognizing = false;
  var committedText = '';
  var interimText = '';
  var lastFinalPrediction = '';
  var lastPredictionAt = 0;

  function setCameraStatus(message) {
    cameraStatus.textContent = message;
  }

  function setDatasetStatus(message) {
    datasetStatus.textContent = message;
  }

  function updateSampleControls() {
    var isRecordingSample = Boolean(sampleRecorder && sampleRecorder.state === 'recording');
    var canRecord = Boolean(stream && sampleConsent.checked &&
      sampleGloss.value.trim() && sampleTranslation.value.trim() &&
      sampleParticipant.value.trim() && languageSelect.value === 'zsl' &&
      typeof window.MediaRecorder === 'function' &&
      !isRecordingSample && (!sampleRecorder || sampleRecorder.state === 'inactive'));
    startSampleButton.disabled = !canRecord;
    stopSampleButton.disabled = !isRecordingSample;
    languageSelect.disabled = isRecordingSample;
    downloadAnnotationsButton.disabled = collectedSamples.length === 0;
  }

  function safeFilenamePart(value) {
    return value.trim().toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'sample';
  }

  function quoteCsv(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  function saveSample() {
    if (discardSampleWhenStopped) {
      discardSampleWhenStopped = false;
      sampleChunks = [];
      activeSampleLabels = null;
      updateSampleControls();
      return;
    }
    var clip = new Blob(sampleChunks, { type: sampleRecorder.mimeType || 'video/webm' });
    if (!clip.size) {
      setDatasetStatus('The browser produced an empty recording. Check MediaRecorder support and try again.');
      sampleChunks = [];
      activeSampleLabels = null;
      updateSampleControls();
      return;
    }
    var gloss = activeSampleLabels.gloss;
    var translation = activeSampleLabels.translation;
    var participant = activeSampleLabels.participant;
    var capturedAt = new Date(sampleStartedAt).toISOString();
    var sampleName = safeFilenamePart(gloss) + '_' +
      safeFilenamePart(participant) + '_' + Date.now() + '.webm';
    downloadBlob(clip, sampleName);
    collectedSamples.push({
      filename: sampleName,
      gloss: gloss,
      english: translation,
      language: 'zsl',
      participant: participant,
      capturedAt: capturedAt,
      durationMs: Date.now() - sampleStartedAt,
      bytes: clip.size
    });
    setDatasetStatus('Saved ' + sampleName + '. Sample ' + collectedSamples.length +
      ' is in your browser downloads; download the labels CSV to keep its annotation.');
    sampleChunks = [];
    activeSampleLabels = null;
    updateSampleControls();
  }

  function startSampleRecording() {
    if (!stream || !sampleConsent.checked || languageSelect.value !== 'zsl') {
      setDatasetStatus('Start the camera, select ZSL, and confirm informed consent before recording a sample.');
      return;
    }
    if (!sampleGloss.value.trim() || !sampleTranslation.value.trim() || !sampleParticipant.value.trim()) {
      setDatasetStatus('Enter the ZSL sign/gloss, English meaning, and a pseudonymous participant code.');
      return;
    }
    if (typeof window.MediaRecorder !== 'function') {
      setDatasetStatus('Video recording is not supported in this browser. Use a supported browser or record research samples separately.');
      updateSampleControls();
      return;
    }

    try {
      var supportedMimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      var mimeType = supportedMimeTypes.find(function (type) {
        return MediaRecorder.isTypeSupported(type);
      });
      sampleRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType: mimeType })
        : new MediaRecorder(stream);
      sampleChunks = [];
      sampleStartedAt = Date.now();
      activeSampleLabels = {
        gloss: sampleGloss.value.trim(),
        translation: sampleTranslation.value.trim(),
        participant: sampleParticipant.value.trim()
      };
      discardSampleWhenStopped = false;
      sampleRecorder.addEventListener('dataavailable', function (event) {
        if (event.data && event.data.size) {
          sampleChunks.push(event.data);
        }
      });
      sampleRecorder.addEventListener('stop', saveSample, { once: true });
      sampleRecorder.addEventListener('error', function (event) {
        console.error('Research sample recording failed:', event.error);
        setDatasetStatus('The sample recording failed. Check browser recording support and camera permissions.');
        sampleChunks = [];
        activeSampleLabels = null;
        updateSampleControls();
      }, { once: true });
      sampleRecorder.start(250);
      setDatasetStatus('Recording ' + sampleGloss.value.trim() + ' for participant ' +
        sampleParticipant.value.trim() + '. Sign naturally, then stop and save this clip.');
      updateSampleControls();
    } catch (error) {
      console.error('Research sample recorder could not start:', error);
      setDatasetStatus('The sample recorder could not start (' + error.message + ').');
      updateSampleControls();
    }
  }

  function downloadAnnotations() {
    if (!collectedSamples.length) {
      return;
    }
    var rows = [
      ['filename', 'gloss_zsl', 'english_meaning', 'language', 'participant_code', 'captured_at', 'duration_ms', 'bytes']
    ];
    collectedSamples.forEach(function (sample) {
      rows.push([
        sample.filename, sample.gloss, sample.english, sample.language,
        sample.participant, sample.capturedAt, sample.durationMs, sample.bytes
      ]);
    });
    var csv = '\uFEFF' + rows.map(function (row) {
      return row.map(quoteCsv).join(',');
    }).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'zsl-sign-samples.csv');
    setDatasetStatus('Downloaded the labels CSV for ' + collectedSamples.length +
      ' sample' + (collectedSamples.length === 1 ? '' : 's') + '. Keep it with the downloaded clips.');
  }

  function getProvider() {
    var provider = window.HAND_IN_HAND_VIDEO_TO_TEXT_PROVIDER;
    if (!provider || typeof provider.recognizeFrame !== 'function') {
      return null;
    }
    var language = languageSelect.value;
    var supportsLanguage = provider.language === language ||
      (Array.isArray(provider.languages) && provider.languages.indexOf(language) !== -1);
    return supportsLanguage ? provider : null;
  }

  function updateDictionary(query) {
    dictionaryInput.value = query;
    dictionaryInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderTranscript(searchForSigns) {
    transcript.value = (committedText + (interimText ? (committedText ? ' ' : '') + interimText : '')).trim();
    if (searchForSigns) {
      updateDictionary(transcript.value);
    }
  }

  function appendFinalText(text) {
    var cleanText = text.trim();
    if (!cleanText) {
      return;
    }
    committedText = (committedText + (committedText ? ' ' : '') + cleanText).slice(0, 1000);
    interimText = '';
    renderTranscript(true);
  }

  function updatePrediction(result) {
    if (!result || typeof result.text !== 'string' ||
        (result.isFinal !== true && result.isFinal !== false)) {
      return;
    }
    var text = result.text.trim();
    if (!text) {
      interimText = '';
      lastFinalPrediction = '';
      return;
    }

    if (result.isFinal === true) {
      if (text === lastFinalPrediction) {
        return;
      }
      lastFinalPrediction = text;
      appendFinalText(text);
    } else {
      lastFinalPrediction = '';
      interimText = text;
      renderTranscript(false);
    }

    if (Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1) {
      confidence.textContent = 'Model confidence: ' + Math.round(result.confidence * 100) + '%';
    } else {
      confidence.textContent = '';
    }
    setCameraStatus('Recognized ' + languageSelect.options[languageSelect.selectedIndex].text + '. Review the transcript; dictionary references update automatically.');
  }

  function stopRecognitionLoop() {
    isRecognizing = false;
    window.clearTimeout(recognitionTimer);
  }

  async function recognizeNextFrame() {
    if (!isRecognizing || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      recognitionTimer = window.setTimeout(recognizeNextFrame, 150);
      return;
    }

    var provider = getProvider();
    if (!provider) {
      stopRecognitionLoop();
      setCameraStatus('Camera is on, but no compatible ' + languageSelect.value.toUpperCase() +
        ' sign-recognition model is configured. The camera will not guess signs; you can type text below to search the dictionary.');
      return;
    }

    try {
      var result = await provider.recognizeFrame({
        video: video,
        language: languageSelect.value
      });
      if (!isRecognizing) {
        return;
      }
      if (provider !== getProvider()) {
        stopRecognitionLoop();
        return;
      }
      updatePrediction(result);
      lastPredictionAt = Date.now();
    } catch (error) {
      console.error('Camera sign recognition failed:', error);
      stopRecognitionLoop();
      setCameraStatus('The sign-recognition model failed. Camera preview remains available; check the model configuration and try again.');
      return;
    }

    var wait = Math.max(0, 300 - (Date.now() - lastPredictionAt));
    recognitionTimer = window.setTimeout(recognizeNextFrame, wait);
  }

  function stopCamera(discardActiveSample) {
    stopRecognitionLoop();
    if (sampleRecorder && sampleRecorder.state === 'recording') {
      discardSampleWhenStopped = Boolean(discardActiveSample);
      sampleRecorder.stop();
    }
    if (stream) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      stream = null;
    }
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    placeholder.hidden = false;
    cameraPanel.classList.remove('is-recording');
    startButton.disabled = false;
    stopButton.disabled = true;
    updateSampleControls();
  }

  startButton.addEventListener('click', async function () {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setCameraStatus('Camera access is unavailable in this browser. Use HTTPS or localhost, or enter text below.');
      return;
    }

    startButton.disabled = true;
    setCameraStatus('Requesting camera permission…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user' }
      });
      video.srcObject = stream;
      video.hidden = false;
      placeholder.hidden = true;
      await video.play();
      cameraPanel.classList.add('is-recording');
      stopButton.disabled = false;

      var provider = getProvider();
      if (provider) {
        isRecognizing = true;
        setCameraStatus('Camera is on. Sign clearly in ' + languageSelect.options[languageSelect.selectedIndex].text + '.');
        recognizeNextFrame();
      } else {
        setCameraStatus('Camera preview is on, but no compatible ' + languageSelect.value.toUpperCase() +
          ' sign-recognition model is configured. No signs will be guessed; manual text and dictionary lookup are available.');
      }
      updateSampleControls();
    } catch (error) {
      console.error('Camera could not start:', error);
      stopCamera();
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraStatus('Camera permission was denied. Allow camera access in browser settings to try again.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraStatus('No camera was found. Connect a camera or enter text manually.');
      } else {
        setCameraStatus('Camera could not start (' + error.message + '). Use HTTPS or localhost and check camera permissions.');
      }
    }
  });

  stopButton.addEventListener('click', function () {
    stopCamera();
    setCameraStatus('Camera stopped. Your recognized text is still available.');
  });

  [sampleGloss, sampleTranslation, sampleParticipant, sampleConsent].forEach(function (input) {
    input.addEventListener('input', updateSampleControls);
    input.addEventListener('change', updateSampleControls);
  });
  sampleConsent.addEventListener('change', function () {
    if (!sampleConsent.checked && sampleRecorder && sampleRecorder.state === 'recording') {
      discardSampleWhenStopped = true;
      sampleRecorder.stop();
      setDatasetStatus('Consent was withdrawn. The current clip will be discarded.');
    }
  });
  languageSelect.addEventListener('change', updateSampleControls);
  startSampleButton.addEventListener('click', startSampleRecording);
  stopSampleButton.addEventListener('click', function () {
    if (sampleRecorder && sampleRecorder.state === 'recording') {
      sampleRecorder.stop();
      setDatasetStatus('Finalizing the clip and saving it to your browser downloads…');
      updateSampleControls();
    }
  });
  downloadAnnotationsButton.addEventListener('click', downloadAnnotations);

  transcript.addEventListener('input', function () {
    committedText = transcript.value;
    interimText = '';
    updateDictionary(committedText);
  });

  document.getElementById('clear-transcript').addEventListener('click', function () {
    committedText = '';
    interimText = '';
    lastFinalPrediction = '';
    confidence.textContent = '';
    renderTranscript(true);
    dictionaryResults.replaceChildren();
    var empty = document.createElement('p');
    empty.className = 'results-empty';
    empty.textContent = 'Sign dictionary photos for recognized words will appear here.';
    dictionaryResults.appendChild(empty);
  });

  document.getElementById('find-transcript-signs').addEventListener('click', function () {
    updateDictionary(transcript.value.trim());
    dictionaryForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  languageSelect.addEventListener('change', function () {
    if (!stream) {
      return;
    }
    stopRecognitionLoop();
    if (getProvider()) {
      isRecognizing = true;
      setCameraStatus('Camera is on. Sign clearly in ' + languageSelect.options[languageSelect.selectedIndex].text + '.');
      recognizeNextFrame();
    } else {
      setCameraStatus('The connected model does not support ' + languageSelect.value.toUpperCase() +
        '. Camera preview remains on; sign recognition is paused.');
    }
  });

  dictionaryForm.addEventListener('submit', function (event) {
    event.preventDefault();
  });

  window.addEventListener('pagehide', function () {
    stopCamera(true);
  });
  updateSampleControls();
}());

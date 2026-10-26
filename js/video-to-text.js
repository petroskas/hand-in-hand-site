(function () {
  'use strict';

  var cameraPanel = document.querySelector('.camera-panel');
  var video = document.getElementById('camera-preview');
  var placeholder = document.getElementById('camera-placeholder');
  var startButton = document.getElementById('start-camera');
  var stopButton = document.getElementById('stop-camera');
  var cameraStatus = document.getElementById('camera-status');
  var transcript = document.getElementById('recognized-text');
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
      sampleParticipant.value.trim() &&
      typeof window.MediaRecorder === 'function' &&
      !isRecordingSample && (!sampleRecorder || sampleRecorder.state === 'inactive'));
    startSampleButton.disabled = !canRecord;
    stopSampleButton.disabled = !isRecordingSample;
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
      setDatasetStatus('No video was saved. Check camera access and try again.');
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
    setDatasetStatus('Sample ' + collectedSamples.length + ' saved. Download the labels CSV to keep its details.');
    sampleChunks = [];
    activeSampleLabels = null;
    updateSampleControls();
  }

  function startSampleRecording() {
    if (!stream || !sampleConsent.checked) {
      setDatasetStatus('Start the camera and confirm the signer’s consent before recording a sample.');
      return;
    }
    if (!sampleGloss.value.trim() || !sampleTranslation.value.trim() || !sampleParticipant.value.trim()) {
      setDatasetStatus('Enter the sign label, English meaning, and participant code.');
      return;
    }
    if (typeof window.MediaRecorder !== 'function') {
      setDatasetStatus('Video recording is not supported in this browser.');
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
        setDatasetStatus('The sample could not be saved. Check camera access and try again.');
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
      setDatasetStatus('Recording could not start. Check camera access and try again.');
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
    var language = 'zsl';
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

    setCameraStatus('Your message was updated. Matching sign photos appear below.');
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
      setCameraStatus('Camera sign recognition is not available yet. Type a message below to look up signs.');
      return;
    }

    try {
      var result = await provider.recognizeFrame({
        video: video,
        language: 'zsl'
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
      setCameraStatus('Sign recognition is not available right now. You can type a message below to look up signs.');
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
      setCameraStatus('Camera access is unavailable. You can still type a message below to look up signs.');
      return;
    }

    startButton.disabled = true;
    setCameraStatus('Waiting for camera permission…');
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
        setCameraStatus('Camera is on. Use the form below to record a sample.');
        recognizeNextFrame();
      } else {
        setCameraStatus('Camera preview is on. Live sign recognition is not available yet.');
      }
      updateSampleControls();
    } catch (error) {
      console.error('Camera could not start:', error);
      stopCamera();
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraStatus('Camera permission was not granted. Allow camera access in your browser settings to try again.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setCameraStatus('No camera was found. You can still type a message below to look up signs.');
      } else {
        setCameraStatus('Camera could not start. Check your camera permission and try again.');
      }
    }
  });

  stopButton.addEventListener('click', function () {
    stopCamera();
    setCameraStatus('Camera stopped. Your message is still available.');
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
  startSampleButton.addEventListener('click', startSampleRecording);
  stopSampleButton.addEventListener('click', function () {
    if (sampleRecorder && sampleRecorder.state === 'recording') {
      sampleRecorder.stop();
      setDatasetStatus('Saving your sample…');
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
    renderTranscript(true);
    dictionaryResults.replaceChildren();
    var empty = document.createElement('p');
    empty.className = 'results-empty';
    empty.textContent = 'Sign photos and spelling aids will appear here.';
    dictionaryResults.appendChild(empty);
  });

  document.getElementById('find-transcript-signs').addEventListener('click', function () {
    updateDictionary(transcript.value.trim());
    dictionaryForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  dictionaryForm.addEventListener('submit', function (event) {
    event.preventDefault();
  });

  window.addEventListener('pagehide', function () {
    stopCamera(true);
  });
  updateSampleControls();
}());

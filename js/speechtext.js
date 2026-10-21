(function () {
  'use strict';

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var noteTextarea = $('#english-text');
  var instructions = $('#recording-instructions');
  var recordButton = $('#start-record-btn');
  var pauseButton = $('#pause-record-btn');
  var recognition;
  var sessionText = '';
  var finalTranscript = '';
  var interimTranscript = '';
  var isRenderingTranscript = false;
  var isListening = false;
  var recognitionError = false;

  function setStatus(message) {
    instructions.text(message);
  }

  function joinTranscript(base, transcript) {
    if (!base) {
      return transcript;
    }
    if (!transcript) {
      return base;
    }
    return base + (/\s$/.test(base) ? '' : ' ') + transcript;
  }

  function showUnsupported(message) {
    $('.no-browser-support').text(message).show();
    recordButton.prop('disabled', true);
    setStatus(message);
  }

  if (!noteTextarea.length || !recordButton.length || !pauseButton.length) {
    return;
  }

  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    showUnsupported('Voice input requires a secure HTTPS connection. You can still type a word to find its sign.');
    return;
  }

  if (!SpeechRecognition) {
    showUnsupported('Live speech recognition is not supported in this browser. You can still type a word to find its sign.');
    return;
  }

  try {
    recognition = new SpeechRecognition();
  } catch (error) {
    console.error('Speech recognition could not be initialized:', error);
    showUnsupported('Voice recognition could not initialize in this browser. You can still type a word to find its sign.');
    return;
  }
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = /^en(?:-|$)/i.test(navigator.language) ? navigator.language : 'en-US';

  recognition.onstart = function () {
    isListening = true;
    recognitionError = false;
    recordButton.prop('disabled', true);
    pauseButton.prop('disabled', false);
    setStatus('Listening… speak naturally. Words and dictionary signs will appear as you speak.');
  };

  recognition.onresult = function (event) {
    interimTranscript = '';

    for (var index = event.resultIndex; index < event.results.length; index += 1) {
      var result = event.results[index];
      var transcript = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    var recognizedText = (finalTranscript + interimTranscript).trim();
    var displayedText = joinTranscript(sessionText, recognizedText);
    isRenderingTranscript = true;
    noteTextarea.val(displayedText)[0].dispatchEvent(new Event('input', { bubbles: true }));
    isRenderingTranscript = false;

    if (interimTranscript) {
      setStatus('Hearing: ' + recognizedText + '. Matching sign photos are updating as you speak.');
    } else if (recognizedText) {
      setStatus('Recognized: ' + recognizedText + '. Matching sign photos are beside the fingerspelling preview.');
    }
  };

  recognition.onspeechend = function () {
    if (isListening) {
      setStatus('Still listening. Speak when you are ready; recognized words and signs will appear automatically.');
    }
  };

  recognition.onerror = function (event) {
    var messages = {
      'no-speech': 'No speech was heard. Check your microphone and try speaking again.',
      'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
      'service-not-allowed': 'The browser speech-recognition service is unavailable. You can still type a word to find its sign.',
      'audio-capture': 'No microphone was found. Connect or enable a microphone, or type a word instead.',
      'network': 'Speech recognition needs an internet connection. Check your connection or type a word instead.',
      'language-not-supported': 'Speech recognition does not support your browser language. Try changing your browser language to English.',
      'aborted': 'Voice input stopped.'
    };
    recognitionError = true;
    setStatus(messages[event.error] || 'Voice input could not start (' + event.error + '). Check microphone permissions or type a word instead.');
  };

  recognition.onend = function () {
    isListening = false;
    recordButton.prop('disabled', false);
    pauseButton.prop('disabled', true);
    if (!recognitionError && instructions.text().indexOf('Voice recognition paused') !== 0) {
      setStatus('Voice input stopped. Select Record to speak again, or type a word to find its sign.');
    }
  };

  recordButton.on('click', function () {
    sessionText = noteTextarea.val();
    finalTranscript = '';
    interimTranscript = '';
    try {
      recognition.start();
    } catch (error) {
      if (error.name === 'InvalidStateError') {
        setStatus('Voice recognition is already listening.');
      } else {
        setStatus('Voice recognition could not start. Check microphone permissions or type a word instead.');
        console.error('Speech recognition could not start:', error);
      }
    }
  });

  pauseButton.prop('disabled', true).on('click', function () {
    if (isListening) {
      recognition.stop();
      setStatus('Voice recognition paused. Your recognized words and matching signs are still shown.');
    }
  });

  noteTextarea.on('input', function () {
    if (!isRenderingTranscript && isListening) {
      sessionText = noteTextarea.val();
      finalTranscript = '';
      interimTranscript = '';
    }
  });
}());

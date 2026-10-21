(function () {
  'use strict';

  var textInput = document.getElementById('voice-text');
  var dictionaryInput = document.getElementById('dictionary-query');
  var dictionaryForm = document.getElementById('dictionary-lookup');
  var dictionaryResults = document.getElementById('dictionary-results');
  var generateButton = document.getElementById('generate-signs');
  var microphoneButton = document.getElementById('voice-mic');
  var status = document.getElementById('voice-status');
  var player = document.getElementById('sign-player');
  var generatedVideo = document.getElementById('generated-sign-video');
  var imageSequenceFrame = document.getElementById('image-sequence-frame');
  var imageSpeedControl = document.getElementById('image-speed-control');
  var playerControls = player.querySelector('.player-controls');
  var referenceImage = document.getElementById('reference-image');
  var emptyMessage = document.getElementById('reference-empty');
  var frameWord = document.getElementById('frame-word');
  var frameSource = document.getElementById('frame-source');
  var frameKind = document.getElementById('frame-kind');
  var frameCount = document.getElementById('frame-count');
  var progress = document.getElementById('timeline-progress');
  var playbackSpeed = document.getElementById('playback-speed');
  var playButton = document.getElementById('play-signs');
  var previousButton = document.getElementById('previous-frame');
  var nextButton = document.getElementById('next-frame');
  var frames = [];
  var currentFrame = 0;
  var playbackTimer;
  var autoPlayWhenReady = false;
  var providerRequestId = 0;
  var showingGeneratedVideo = false;
  var providerStatusNotice = '';
  var recognition;
  var isListening = false;

  function setStatus(message) {
    status.textContent = message;
  }

  function getZslVideoProvider() {
    var provider = window.HAND_IN_HAND_SIGN_VIDEO_PROVIDER;
    return provider && typeof provider.generateVideo === 'function' ? provider : null;
  }

  function supportsZsl(provider) {
    return provider.language === 'zsl' ||
      (Array.isArray(provider.languages) && provider.languages.indexOf('zsl') !== -1);
  }

  function useImageFallback(message) {
    if (!showingGeneratedVideo) {
      return;
    }
    showingGeneratedVideo = false;
    generatedVideo.pause();
    generatedVideo.hidden = true;
    imageSequenceFrame.hidden = false;
    playerControls.hidden = false;
    imageSpeedControl.hidden = false;
    setStatus(message);
  }

  function displayGeneratedVideo(videoUrl, shouldPlay) {
    var parsedUrl;
    try {
      parsedUrl = new URL(videoUrl, window.location.href);
    } catch (error) {
      throw new Error('The sign-video provider returned an invalid video URL.');
    }
    if (['http:', 'https:', 'blob:'].indexOf(parsedUrl.protocol) === -1) {
      throw new Error('The sign-video provider must return an HTTP or blob video URL.');
    }

    setPlaying(false);
    showingGeneratedVideo = true;
    imageSequenceFrame.hidden = true;
    playerControls.hidden = true;
    imageSpeedControl.hidden = true;
    generatedVideo.hidden = false;
    generatedVideo.src = parsedUrl.href;
    generatedVideo.load();
    if (shouldPlay) {
      generatedVideo.play().catch(function (error) {
        if (!showingGeneratedVideo) {
          return;
        }
        if (error.name === 'NotAllowedError') {
          setStatus('The ZSL sign video is ready. Press play on the video to start.');
          return;
        }
        console.error('Generated sign video could not play:', error);
        useImageFallback('The generated ZSL video could not play. Switched back to the dictionary-photo and fingerspelling sequence.');
      });
    }
    setStatus('Showing a ZSL sign video from the configured signing provider.');
  }

  function requestGeneratedVideo(text, shouldPlay, requestId) {
    var provider = getZslVideoProvider();
    if (!provider) {
      providerStatusNotice = 'No ZSL video provider is configured; using the current photo and fingerspelling sequence.';
      return false;
    }

    if (!supportsZsl(provider)) {
      providerStatusNotice = 'The configured provider does not declare ZSL support; using the current photo and fingerspelling sequence.';
      setStatus(providerStatusNotice);
      return true;
    }

    providerStatusNotice = '';
    setStatus('Checking the configured ZSL video provider. Dictionary-photo and fingerspelling fallback remains available.');
    Promise.resolve().then(function () {
      return provider.generateVideo({ text: text, language: 'zsl' });
    }).then(function (result) {
      if (requestId !== providerRequestId) {
        return;
      }
      if (!result || result.language !== 'zsl' ||
          typeof result.videoUrl !== 'string' || !result.videoUrl.trim()) {
        throw new Error('The configured ZSL video provider must return a video URL and confirm language "zsl".');
      }
      displayGeneratedVideo(result.videoUrl, shouldPlay);
    }).catch(function (error) {
      if (requestId !== providerRequestId) {
        return;
      }
      console.error('ZSL sign-video provider failed:', error);
      providerStatusNotice = (error.message || 'The ZSL sign-video provider failed.') +
        ' Showing the available dictionary-photo and fingerspelling sequence instead.';
      setStatus(providerStatusNotice);
    });
    return true;
  }

  function setPlaying(playing) {
    window.clearTimeout(playbackTimer);
    player.classList.toggle('is-playing', playing);
    playButton.textContent = playing ? 'Ⅱ' : '▶';
    playButton.setAttribute('aria-label', playing ? 'Pause sign sequence' : 'Play sign sequence');
    if (playing && frames.length) {
      var speed = Number(playbackSpeed.value) || 1;
      playbackTimer = window.setTimeout(function () {
        if (currentFrame >= frames.length - 1) {
          setPlaying(false);
          setStatus('Sign sequence finished. Press play to watch it again.');
          return;
        }
        showFrame(currentFrame + 1);
        setPlaying(true);
      }, frames[currentFrame].duration / speed);
    }
  }

  function showFrame(index) {
    if (!frames.length) {
      return;
    }
    currentFrame = (index + frames.length) % frames.length;
    var frame = frames[currentFrame];
    referenceImage.hidden = false;
    emptyMessage.hidden = true;
    referenceImage.classList.remove('frame-enter');
    void referenceImage.offsetWidth;
    referenceImage.classList.add('frame-enter');
    referenceImage.alt = frame.alt;
    referenceImage.onerror = function () {
      setStatus('A sign reference image could not be loaded. Check that the dictionary image files are deployed with the site.');
    };
    referenceImage.src = frame.image;
    frameWord.textContent = frame.word;
    frameSource.textContent = frame.source;
    frameKind.textContent = frame.kind === 'letter' ? 'ASL fingerspelling' : 'Dictionary sign reference';
    frameKind.hidden = false;
    frameCount.textContent = (currentFrame + 1) + ' / ' + frames.length;
    progress.style.width = ((currentFrame + 1) / frames.length * 100) + '%';
    playButton.disabled = false;
    previousButton.disabled = frames.length < 2;
    nextButton.disabled = frames.length < 2;
  }

  function collectFrames() {
    var nextFrames = [];
    dictionaryResults.querySelectorAll('.dictionary-card, .asl-fallback-card').forEach(function (card) {
      if (card.classList.contains('asl-fallback-card')) {
        var title = card.querySelector('h4');
        var word = title ? title.textContent.trim() : 'Fingerspelling';
        card.querySelectorAll('.asl-spelling img').forEach(function (image) {
          nextFrames.push({
            image: image.getAttribute('src'),
            alt: image.alt,
            word: image.alt.replace(/^ASL letter\s*/i, '').toUpperCase(),
            source: 'ASL alphabet handshape for “' + word + '”',
            kind: 'letter',
            duration: 1050
          });
        });
        return;
      }

      var image = card.querySelector('img');
      var title = card.querySelector('h3');
      var source = card.querySelector('.dictionary-card-source');
      if (image && title && image.getAttribute('src')) {
        nextFrames.push({
          image: image.getAttribute('src'),
          alt: image.alt,
          word: title.textContent.trim(),
          source: source ? source.textContent.trim() : 'Dictionary sign reference',
          kind: 'sign',
          duration: 2600
        });
      }
    });
    return nextFrames;
  }

  function clearSequence() {
    setPlaying(false);
    showingGeneratedVideo = false;
    generatedVideo.pause();
    generatedVideo.removeAttribute('src');
    generatedVideo.load();
    generatedVideo.hidden = true;
    imageSequenceFrame.hidden = false;
    playerControls.hidden = false;
    imageSpeedControl.hidden = false;
    frames = [];
    currentFrame = 0;
    referenceImage.hidden = true;
    referenceImage.removeAttribute('src');
    referenceImage.alt = '';
    referenceImage.classList.remove('frame-enter');
    emptyMessage.hidden = false;
    frameKind.hidden = true;
    frameWord.textContent = 'Ready to play';
    frameSource.textContent = 'Dictionary photos and letter handshapes are visual references.';
    frameCount.textContent = '0 / 0';
    progress.style.width = '0%';
    playButton.disabled = true;
    previousButton.disabled = true;
    nextButton.disabled = true;
  }

  function refreshSequence() {
    var nextFrames = collectFrames();
    if (showingGeneratedVideo) {
      return;
    }
    if (!nextFrames.length) {
      clearSequence();
      if (dictionaryResults.querySelector('.results-message.error')) {
        setStatus('The sign dictionaries could not be loaded. Check the local dictionary index files and try again.');
      } else if (dictionaryResults.querySelector('.results-message')) {
        setStatus('Looking up dictionary signs and preparing the animation…');
      } else if (dictionaryResults.querySelector('.results-empty')) {
        setStatus('Enter a word or phrase to prepare its sign sequence.');
      } else if (!dictionaryResults.querySelector('.results-message')) {
        setStatus('No sign frames were found. Try another phrase or check the dictionary reference.');
      }
      return;
    }

    frames = nextFrames;
    setPlaying(false);
    showFrame(0);
    setStatus(frames.length + ' sign frame' + (frames.length === 1 ? '' : 's') + ' ready. ZSL dictionary images are preferred; missing words use the existing ASL fingerspelling fallback.' +
      (providerStatusNotice ? ' ' + providerStatusNotice : ''));
    if (autoPlayWhenReady) {
      autoPlayWhenReady = false;
      setPlaying(true);
    }
  }

  function requestSequence(shouldPlay) {
    var text = textInput.value.trim();
    if (!text) {
      setStatus('Type a word or phrase before creating a sign sequence.');
      textInput.focus();
      return;
    }
    if (text.length > 250) {
      setStatus('Please shorten your phrase to 250 characters or fewer.');
      return;
    }
    autoPlayWhenReady = Boolean(shouldPlay);
    providerStatusNotice = '';
    providerRequestId += 1;
    clearSequence();
    dictionaryInput.value = text;
    dictionaryForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    var hasProvider = requestGeneratedVideo(text, autoPlayWhenReady, providerRequestId);
    if (!hasProvider) {
      setStatus('Preparing the existing dictionary-image and fingerspelling sequence. ' + providerStatusNotice);
    }
  }

  textInput.addEventListener('input', function () {
    dictionaryInput.value = textInput.value;
    dictionaryInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  generateButton.addEventListener('click', function () {
    requestSequence(true);
  });
  playButton.addEventListener('click', function () {
    if (!frames.length) {
      return;
    }
    if (player.classList.contains('is-playing')) {
      setPlaying(false);
    } else {
      if (currentFrame === frames.length - 1) {
        showFrame(0);
      }
      setPlaying(true);
    }
  });
  previousButton.addEventListener('click', function () {
    setPlaying(false);
    showFrame(currentFrame - 1);
  });
  nextButton.addEventListener('click', function () {
    setPlaying(false);
    showFrame(currentFrame + 1);
  });
  playbackSpeed.addEventListener('change', function () {
    if (player.classList.contains('is-playing')) {
      setPlaying(true);
    }
  });

  new MutationObserver(refreshSequence).observe(dictionaryResults, { childList: true, subtree: true });
  generatedVideo.addEventListener('error', function () {
    useImageFallback('The generated sign video could not be loaded. The existing dictionary-image and fingerspelling sequence remains available.');
  });

  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    microphoneButton.disabled = true;
    setStatus('Microphone input requires a secure HTTPS connection. You can still type a phrase.');
  } else if (!SpeechRecognition) {
    microphoneButton.disabled = true;
    setStatus('Speech recognition is not supported in this browser. You can still type a phrase.');
  } else {
    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = /^en(?:-|$)/i.test(navigator.language) ? navigator.language : 'en-US';
      recognition.onstart = function () {
        isListening = true;
        microphoneButton.setAttribute('aria-pressed', 'true');
        microphoneButton.innerHTML = '<span aria-hidden="true">●</span> Stop listening';
        setStatus('Listening… speak clearly. Your recognized words will appear in the text box.');
      };
      recognition.onresult = function (event) {
        var transcript = '';
        var hasFinalResult = false;
        for (var index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript;
          hasFinalResult = hasFinalResult || event.results[index].isFinal;
        }
        textInput.value = transcript.trim();
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (hasFinalResult && textInput.value) {
          requestSequence(true);
        } else if (textInput.value) {
          setStatus('Recognized so far: ' + textInput.value);
        }
      };
      recognition.onerror = function (event) {
        var messages = {
          'not-allowed': 'Microphone permission was denied. Allow access in browser settings or type a phrase.',
          'service-not-allowed': 'The browser speech service is unavailable. You can still type a phrase.',
          'audio-capture': 'No microphone was found. Connect a microphone or type a phrase.',
          'network': 'Speech recognition needs an internet connection. Check your connection or type a phrase.',
          'no-speech': 'No speech was heard. Try again or type a phrase.',
          'language-not-supported': 'Speech recognition does not support this browser language. Try typing a phrase.'
        };
        setStatus(messages[event.error] || 'Voice recognition failed (' + event.error + '). You can still type a phrase.');
      };
      recognition.onend = function () {
        isListening = false;
        microphoneButton.setAttribute('aria-pressed', 'false');
        microphoneButton.innerHTML = '<span aria-hidden="true">●</span> Speak';
      };
      microphoneButton.addEventListener('click', function () {
        if (isListening) {
          recognition.stop();
          return;
        }
        try {
          recognition.start();
        } catch (error) {
          if (error.name === 'InvalidStateError') {
            setStatus('Voice recognition is already listening.');
          } else {
            console.error('Voice recognition could not start:', error);
            setStatus('Voice recognition could not start. Check microphone permissions or type a phrase.');
          }
        }
      });
    } catch (error) {
      console.error('Speech recognition could not be initialized:', error);
      microphoneButton.disabled = true;
      setStatus('Speech recognition could not be initialized. You can still type a phrase.');
    }
  }
}());

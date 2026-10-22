(function () {
  'use strict';

  function normalize(value) {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  function tokenize(value) {
    return value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  }

  function getWordLabels(label, allowSingleCharacterPrimary) {
    var parenthetical = label.match(/^(.*?)\s*\(([^)]*)\)/);
    var primaryLabels = (parenthetical ? parenthetical[1] : label).split(/[\/,;]/);
    var alternateLabels = parenthetical ? parenthetical[2].split(/[\/,;]/) : [];
    var variants = primaryLabels.concat(alternateLabels);
    var labels = Array.from(new Set(variants.map(function (variant) {
      return variant.trim();
    }).filter(function (variant) {
      var isPrimaryLabel = primaryLabels.some(function (primary) {
        return primary.trim() === variant.trim();
      });
      return /[a-z]/i.test(variant) && (normalize(variant).length > 1 ||
        (allowSingleCharacterPrimary && isPrimaryLabel && /^[a-z]$/i.test(variant.trim())));
    })));
    return labels.length ? labels : [label];
  }

  function loadDictionary() {
    var pdfOnlyDeployment = window.HAND_IN_HAND_DICTIONARY_MODE === 'pdf-only';
    var filenames = window.SIGN_DICTIONARY_FILES;
    if (!Array.isArray(filenames)) {
      throw new Error('The sign dictionary index could not be loaded. Keep js/dictionary-index.js beside the translator files.');
    }
    var pngEntries = (pdfOnlyDeployment ? [] : filenames).map(function (filename) {
      var word = filename.replace(/\.png$/i, '').replace(/\s+\(\d+\)$/, '');
      return {
        word: word,
        meanings: [],
        searchTerms: [word],
        filename: filename,
        normalized: normalize(word),
        image: './dictionary/' + encodeURIComponent(filename),
        source: 'zsl-image'
      };
    }).filter(function (entry) {
      return entry.normalized.length > 0;
    });
    var pdfEntries = window.PDF_SIGN_DICTIONARY;
    if (!Array.isArray(pdfEntries)) {
      throw new Error('The scanned PDF sign index could not be loaded. Keep js/pdf-sign-index.js beside the translator files.');
    }
    return pngEntries.concat((pdfOnlyDeployment ? [] : pdfEntries).map(function (entry) {
      var labels = getWordLabels(entry.word, false);
      return {
        word: labels[0],
        meanings: labels.slice(1),
        searchTerms: labels,
        filename: entry.image,
        normalized: normalize(labels[0]),
        image: entry.image,
        source: 'zsl-pdf'
      };
    }).filter(function (entry) {
      return entry.normalized.length > 0;
    })).concat((function () {
      var joyEntries = window.JOY_SIGN_DICTIONARY;
      if (!Array.isArray(joyEntries)) {
        throw new Error('The Joy of Signing page index could not be loaded. Keep js/joy-sign-index.js beside the translator files.');
      }
      return (pdfOnlyDeployment ? [] : joyEntries).map(function (entry) {
        var labels = getWordLabels(entry.word, true);
        return {
          word: labels[0],
          meanings: labels.slice(1),
          searchTerms: labels,
          filename: entry.image,
          normalized: normalize(labels[0]),
          image: entry.image,
          source: 'asl-snippet',
          page: Number(entry.page)
        };
      }).filter(function (entry) {
        return entry.normalized.length > 0 && typeof entry.image === 'string' &&
          Number.isInteger(entry.page) && entry.page > 0;
      });
    }()));
  }

  function addMessage(container, text, className) {
    var message = document.createElement('p');
    message.className = className || 'results-message';
    message.textContent = text;
    container.appendChild(message);
  }

  function addCard(container, item, displayWord) {
    var card = document.createElement('article');
    var title = document.createElement('h3');
    var label = displayWord || item.word;

    var image = document.createElement('img');
    card.className = 'dictionary-card' + (item.source === 'asl-snippet' ? ' dictionary-card-source-asl' : '');
    image.alt = item.source === 'asl-snippet'
      ? 'American Sign Language sign illustration for ' + label
      : 'Zimbabwean Sign Language dictionary sign for ' + label;
    image.loading = 'lazy';
    image.addEventListener('error', function () {
      image.remove();
      addMessage(card, 'Image could not be loaded. Showing fingerspelling.', 'results-message error');
      addAslFallback(card, [label], false);
    }, { once: true });
    image.src = item.image;
    card.appendChild(image);
    title.textContent = label;
    card.appendChild(title);
    var source = document.createElement('p');
    source.className = 'dictionary-card-source';
    if (item.source === 'asl-snippet') {
      source.textContent = 'ASL visual reference · The Joy of Signing, page ' + item.page;
    } else {
      source.textContent = item.source === 'zsl-pdf'
        ? 'Source: scanned Zimbabwean Sign Language dictionary.'
        : 'Source: Zimbabwean Sign Language image dictionary.';
    }
    card.appendChild(source);
    var meaningsToShow = item.meanings.slice();
    if (normalize(label) !== normalize(item.word)) {
      meaningsToShow.unshift('Dictionary entry: ' + item.word);
    }
    if (meaningsToShow.length) {
      var meanings = document.createElement('p');
      meanings.className = 'dictionary-card-meaning';
      meanings.textContent = (normalize(label) !== normalize(item.word) ? '' : 'Also means: ') +
        meaningsToShow.join(', ');
      card.appendChild(meanings);
    }
    container.appendChild(card);
  }

  function addHeading(container, text) {
    var heading = document.createElement('h3');
    heading.className = 'results-heading';
    heading.textContent = text;
    container.appendChild(heading);
  }

  function preferZslEntries(entries) {
    var zslEntries = entries.filter(function (entry) {
      return entry.source !== 'asl-snippet';
    });
    if (!zslEntries.length) {
      return entries;
    }
    var imageEntries = zslEntries.filter(function (entry) {
      return entry.source === 'zsl-image';
    });
    return imageEntries.length ? imageEntries : zslEntries;
  }

  function findRelatedZslEntries(word, dictionary) {
    var target = normalize(word);
    if (target.length < 2 && target !== 'i') {
      return [];
    }
    var aliases = {
      i: ['me', 'myself'],
      am: ['be'],
      is: ['be'],
      are: ['be'],
      was: ['be'],
      were: ['be'],
      not: ['no', 'negative']
    };
    var targets = target === 'i' ? aliases[target] : [target].concat(aliases[target] || []);
    var matches = [];
    var matchedTarget = target;
    for (var targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      matches = dictionary.filter(function (entry) {
        return entry.source !== 'asl-snippet' && entry.searchTerms.some(function (label) {
          return tokenize(label).some(function (labelWord) {
            return normalize(labelWord) === targets[targetIndex];
          });
        });
      });
      if (matches.length) {
        matchedTarget = targets[targetIndex];
        break;
      }
    }
    if (!matches.length) {
      return [];
    }

    var shortestLabel = Math.min.apply(null, matches.map(function (entry) {
      return Math.min.apply(null, entry.searchTerms.map(function (label) {
        return tokenize(label).length;
      }));
    }));
    return preferZslEntries(matches.filter(function (entry) {
      return entry.searchTerms.some(function (label) {
        return tokenize(label).length === shortestLabel &&
        tokenize(label).some(function (labelWord) { return normalize(labelWord) === matchedTarget; });
      });
    }));
  }

  function addAslFallback(container, terms, includeHeading) {
    if (includeHeading !== false) {
      addHeading(container, 'ASL fingerspelling fallback');
    }
    terms.forEach(function (term) {
      var card = document.createElement('article');
      var title = document.createElement('h4');
      var spelling = document.createElement('div');
      var characters = normalize(term).match(/[a-z0-9]/g) || [];

      card.className = 'asl-fallback-card';
      title.textContent = term;
      spelling.className = 'asl-spelling';
      spelling.setAttribute('aria-label', 'ASL fingerspelling for ' + term);
      var source = document.createElement('p');
      source.className = 'dictionary-card-source';
      source.textContent = 'ASL fingerspelling';

      characters.forEach(function (character) {
        var image = document.createElement('img');
        var filename = character === 'g' ? 'G' : character;
        image.src = './images/ASL_signs/' + filename + '.png';
        image.alt = 'ASL letter ' + character;
        image.loading = 'lazy';
        image.addEventListener('error', function () {
          var unavailable = document.createElement('span');
          unavailable.className = 'asl-letter-unavailable';
          unavailable.textContent = character + ' image unavailable';
          image.replaceWith(unavailable);
        }, { once: true });
        spelling.appendChild(image);
      });

      card.appendChild(title);
      card.appendChild(spelling);
      card.appendChild(source);
      container.appendChild(card);
    });
  }

  function searchTerms(query, splitWords) {
    if (splitWords && query.length > 250) {
      return tokenize(query)
        .slice(0, 24)
        .map(function (word) { return word.toLowerCase(); });
    }

    var terms = [query];
    if (!splitWords) {
      return terms;
    }

    var words = tokenize(query);
    if (words.length > 1) {
      terms = terms.concat(words.map(function (word) { return word.toLowerCase(); }));
      for (var index = 0; index < words.length - 1; index += 1) {
        terms.push(words[index].toLowerCase() + ' ' + words[index + 1].toLowerCase());
      }
    }
    return Array.from(new Set(terms.filter(function (term) { return term.length > 0; })));
  }

  function renderOrderedResults(query, dictionary, container, useAslFallback) {
    var words = tokenize(query);
    var output = [];
    var hasFallback = false;
    var hasMatch = false;

    for (var index = 0; index < words.length;) {
      var matchingEntries = [];
      var matchedWordCount = 0;

      for (var end = words.length; end > index; end -= 1) {
        var phrase = normalize(words.slice(index, end).join(' '));
        matchingEntries = dictionary.filter(function (entry) {
          return entry.searchTerms.some(function (label) {
            return normalize(label) === phrase;
          });
        });
        if (matchingEntries.length) {
          matchedWordCount = end - index;
          break;
        }
      }

      var zslMatches = matchingEntries.filter(function (entry) {
        return entry.source !== 'asl-snippet';
      });
      if (zslMatches.length) {
        matchingEntries = preferZslEntries(zslMatches);
      } else {
        var relatedZslMatches = findRelatedZslEntries(words[index], dictionary);
        if (relatedZslMatches.length) {
          matchingEntries = relatedZslMatches;
          matchedWordCount = 1;
        }
      }

      if (matchingEntries.length) {
        var preferredEntries = preferZslEntries(matchingEntries);
        preferredEntries.forEach(function (entry) {
          output.push({
            type: 'sign',
            entry: entry,
            word: words.slice(index, index + matchedWordCount).join(' ')
          });
          hasMatch = true;
        });
        index += matchedWordCount;
      } else {
        output.push({ type: useAslFallback ? 'fallback' : 'missing', word: words[index] });
        hasFallback = hasFallback || useAslFallback;
        index += 1;
      }
    }

    container.replaceChildren();
    if (hasMatch || hasFallback) {
      addHeading(container, 'Signs in the order entered');
    }
    if (hasFallback) {
      addHeading(container, 'ASL fingerspelling');
    }
    output.forEach(function (item) {
      if (item.type === 'sign') {
        addCard(container, item.entry, item.word);
      } else if (item.type === 'fallback') {
        addAslFallback(container, [item.word], false);
      }
    });
    if (!words.length) {
      addMessage(container, 'Enter a word or phrase to look up a sign.', 'results-empty');
    }
    if (query.length > 250) {
      addMessage(container, 'Showing the first 24 words from this passage. Search a shorter passage to look up the rest.');
    }
  }

  function renderResults(query, terms, dictionary, container, useAslFallback) {
    var matches = [];
    var suggestions = [];
    var fallbackTerms = [];
    terms.forEach(function (term) {
      var needle = normalize(term);
      var exactEntries = dictionary.filter(function (entry) {
        return entry.searchTerms.some(function (label) {
          return normalize(label) === needle;
        });
      });
      var preferredEntries = preferZslEntries(exactEntries);
      preferredEntries.forEach(function (entry) {
        if (!matches.some(function (item) { return item.filename === entry.filename; })) {
          matches.push(entry);
        }
      });
      if (exactEntries.length) {
        return;
      }
      if (window.HAND_IN_HAND_DICTIONARY_MODE !== 'snippets-only') {
        dictionary.forEach(function (entry) {
          if (needle.length >= 2 && entry.searchTerms.some(function (label) {
          return normalize(label).indexOf(needle) !== -1;
          }) && !suggestions.some(function (item) { return item.filename === entry.filename; })) {
            suggestions.push(entry);
          }
        });
      }
    });

    if (useAslFallback) {
      var exactQueryMatch = dictionary.some(function (entry) {
        return entry.searchTerms.some(function (label) {
          return normalize(label) === normalize(query);
        });
      });
      var words = exactQueryMatch ? [] : (query.match(/[a-z0-9]+/gi) || []).slice(0, 24);
      words.forEach(function (word) {
        var needle = normalize(word);
        if (needle && !dictionary.some(function (entry) {
          return entry.searchTerms.some(function (label) { return normalize(label) === needle; });
        }) &&
            !fallbackTerms.some(function (item) { return normalize(item) === needle; })) {
          fallbackTerms.push(word);
        }
      });
    }

    suggestions = preferZslEntries(suggestions);
    suggestions.sort(function (left, right) {
      return left.word.localeCompare(right.word);
    });
    container.replaceChildren();

    if (matches.length) {
      addHeading(container, matches.length === 1 ? 'Matching sign' : 'Matching signs');
      matches.forEach(function (item) { addCard(container, item); });
    }
    if (!matches.length && suggestions.length) {
      addHeading(container, 'Related words');
      suggestions.slice(0, 6).forEach(function (item) { addCard(container, item); });
    }

    if (useAslFallback && fallbackTerms.length) {
      addAslFallback(container, fallbackTerms);
    }
    if (query.length > 250) {
      addMessage(container, 'Showing matching words from the first part of your text. Search a shorter passage to look up the rest.');
    }
  }

  document.querySelectorAll('[data-dictionary-search]').forEach(function (form) {
    var input = document.querySelector(form.getAttribute('data-search-input'));
    var resultsSelector = form.getAttribute('data-results-selector');
    var container = resultsSelector
      ? document.querySelector(resultsSelector)
      : form.parentElement.querySelector('[data-dictionary-results]');
    var timer;
    var requestId = 0;
    var searchDelay = Number(form.getAttribute('data-search-delay'));
    if (!Number.isFinite(searchDelay) || searchDelay < 0) {
      searchDelay = 100;
    }

    if (!input || !container) {
      return;
    }

    async function runSearch() {
      var query = input.value.trim();
      var currentId = ++requestId;
      window.clearTimeout(timer);
      if (!query) {
        container.replaceChildren();
        addMessage(container, 'Enter a word or phrase to look up a sign.', 'results-empty');
        return;
      }
      container.replaceChildren();
      addMessage(container, 'Looking through the sign dictionary…', 'results-message');
      try {
        var dictionary = await loadDictionary();
        if (currentId === requestId) {
          var splitWords = form.getAttribute('data-split-words') === 'true';
          var useAslFallback = form.getAttribute('data-asl-fallback') === 'true';
          if (splitWords) {
            renderOrderedResults(query, dictionary, container, useAslFallback);
          } else {
            renderResults(query, searchTerms(query, splitWords), dictionary, container, useAslFallback);
          }
        }
      } catch (error) {
        if (currentId !== requestId) {
          return;
        }
        container.replaceChildren();
        addMessage(container, error.message || 'The dictionary could not be reached. Please try again.', 'results-message error');
      }
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      runSearch();
    });

    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(runSearch, searchDelay);
    });
  });
}());

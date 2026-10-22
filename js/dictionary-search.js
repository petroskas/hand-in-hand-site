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
    var filenames = window.SIGN_DICTIONARY_FILES;
    if (!Array.isArray(filenames)) {
      throw new Error('The sign dictionary index could not be loaded. Keep js/dictionary-index.js beside the translator files.');
    }
    var pngEntries = filenames.map(function (filename) {
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
    var zslPhotoIndex = window.PDF_SIGN_DICTIONARY;
    if (!Array.isArray(zslPhotoIndex)) {
      throw new Error('The ZSL photo index could not be loaded. Keep js/pdf-sign-index.js beside the translator files.');
    }
    var zslPhotoEntries = zslPhotoIndex.map(function (entry) {
      var labels = getWordLabels(entry.word, false);
      return {
        word: labels[0],
        meanings: labels.slice(1),
        searchTerms: labels,
        filename: entry.image,
        normalized: normalize(labels[0]),
        image: entry.image,
        source: 'zsl-photo'
      };
    }).filter(function (entry) {
      return entry.normalized.length > 0;
    });
    var joyEntries = window.JOY_SIGN_DICTIONARY;
    if (!Array.isArray(joyEntries)) {
      throw new Error('The supplementary sign index could not be loaded. Keep js/joy-sign-index.js beside the translator files.');
    }
    var supplementaryEntries = joyEntries.map(function (entry) {
      var labels = getWordLabels(entry.word, true);
      return {
        word: labels[0],
        meanings: labels.slice(1),
        searchTerms: labels,
        filename: entry.image,
        normalized: normalize(labels[0]),
        image: entry.image,
        source: 'supplementary-image'
      };
    }).filter(function (entry) {
      return entry.normalized.length > 0 && typeof entry.image === 'string';
    });
    return pngEntries.concat(zslPhotoEntries, supplementaryEntries);
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
    var isSupplementary = item.source === 'supplementary-image';
    card.className = 'dictionary-card' + (isSupplementary ? ' dictionary-card-source-supplementary' : '');
    image.alt = isSupplementary
      ? 'Supplementary sign photo for ' + label + ', not confirmed as Zimbabwean Sign Language'
      : 'Zimbabwean Sign Language sign photo for ' + label;
    image.loading = 'lazy';
    image.addEventListener('error', function () {
      image.remove();
      addMessage(card, 'Sign photo could not be loaded. Showing ZSL fingerspelling.', 'results-message error');
      addFingerspellingFallback(card, [label], false);
    }, { once: true });
    image.src = item.image;
    card.appendChild(image);
    title.textContent = label;
    card.appendChild(title);
    var source = document.createElement('p');
    source.className = 'dictionary-card-source';
    if (isSupplementary) {
      source.textContent = 'Supplementary sign photo · not confirmed as Zimbabwean Sign Language';
    } else {
      source.textContent = 'Zimbabwean Sign Language sign photo';
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

  function isZslEntry(entry) {
    return entry.source === 'zsl-image' || entry.source === 'zsl-photo';
  }

  function preferZslEntries(entries) {
    var zslEntries = entries.filter(function (entry) {
      return isZslEntry(entry);
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
        return isZslEntry(entry) && entry.searchTerms.some(function (label) {
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

  function addFingerspellingFallback(container, terms, includeHeading) {
    if (includeHeading !== false) {
      addHeading(container, 'ZSL fingerspelling');
    }
    terms.forEach(function (term) {
      var card = document.createElement('article');
      var title = document.createElement('h4');
      var spelling = document.createElement('div');
      var characters = normalize(term).match(/[a-z0-9]/g) || [];

      card.className = 'fingerspelling-fallback-card';
      title.textContent = term;
      spelling.className = 'fingerspelling-spelling';
      spelling.setAttribute('aria-label', 'Letter-by-letter spelling for ' + term);
      var source = document.createElement('p');
      source.className = 'dictionary-card-source';
      source.textContent = 'ZSL fingerspelling for a word not found in either sign-photo index';

      characters.forEach(function (character) {
        var image = document.createElement('img');
        var filename = character === 'g' ? 'G' : character;
        image.src = './images/ZSL_signs/' + filename + '.png';
        image.alt = 'ZSL fingerspelling handshape for ' + character;
        image.loading = 'lazy';
        image.addEventListener('error', function () {
          var unavailable = document.createElement('span');
          unavailable.className = 'fingerspelling-letter-unavailable';
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

  function renderOrderedResults(query, dictionary, container, useFingerspellingFallback) {
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
        return isZslEntry(entry);
      });
      if (zslMatches.length) {
        matchingEntries = preferZslEntries(zslMatches);
      } else if (matchingEntries.length) {
        matchingEntries = matchingEntries.filter(function (entry) {
          return entry.source === 'supplementary-image';
        });
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
        output.push({ type: useFingerspellingFallback ? 'fallback' : 'missing', word: words[index] });
        hasFallback = hasFallback || useFingerspellingFallback;
        index += 1;
      }
    }

    container.replaceChildren();
    if (hasMatch || hasFallback) {
      addHeading(container, hasFallback
        ? (hasMatch ? 'Sign photos and ZSL fingerspelling' : 'ZSL fingerspelling')
        : 'Sign photos');
    }
    if (hasFallback) {
      addMessage(container, 'No sign photo was found in either index. Showing the word with ZSL fingerspelling.');
    }
    output.forEach(function (item) {
      if (item.type === 'sign') {
        addCard(container, item.entry, item.word);
      } else if (item.type === 'fallback') {
        addFingerspellingFallback(container, [item.word], false);
      }
    });
    if (!words.length) {
      addMessage(container, 'Enter a word or phrase to look up a sign.', 'results-empty');
    }
    if (query.length > 250) {
      addMessage(container, 'Showing the first 24 words from this passage. Search a shorter passage to look up the rest.');
    }
  }

  function renderResults(query, terms, dictionary, container, useFingerspellingFallback) {
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

    if (useFingerspellingFallback) {
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
      addHeading(container, matches.length === 1 ? 'Sign photo' : 'Sign photos');
      matches.forEach(function (item) { addCard(container, item); });
    }
    if (!matches.length && suggestions.length) {
      addHeading(container, 'Related words');
      suggestions.slice(0, 6).forEach(function (item) { addCard(container, item); });
    }

    if (useFingerspellingFallback && fallbackTerms.length) {
      addHeading(container, 'ZSL fingerspelling');
      addMessage(container, 'No sign photo was found in either index. Showing ZSL fingerspelling.');
      addFingerspellingFallback(container, fallbackTerms, false);
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
          var useFingerspellingFallback = form.getAttribute('data-fingerspelling-fallback') === 'true';
          if (splitWords) {
            renderOrderedResults(query, dictionary, container, useFingerspellingFallback);
          } else {
            renderResults(query, searchTerms(query, splitWords), dictionary, container, useFingerspellingFallback);
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

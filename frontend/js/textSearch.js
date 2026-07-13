/**
 * textSearch.js - Textual search utility that traverses text nodes 
 * and highlights matches without breaking HTML markup.
 */

class TextSearch {
  constructor(container) {
    this.container = container;
    this.matches = [];
    this.currentIndex = -1;
    this.originalNodes = []; 
  }

  // Clear previous search marks
  clear() {
    const marks = Array.from(this.container.querySelectorAll('mark.search-match'));
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent), mark);
          parent.normalize(); // merge adjacent text nodes
      }
    });
    this.matches = [];
    this.currentIndex = -1;
  }

  // Escape special regex characters
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Search text and wrap matches
  search(query, caseInsensitive = true) {
    this.clear();
    if (!query.trim()) return 0;

    const regex = new RegExp(`(${this.escapeRegex(query)})`, caseInsensitive ? 'gi' : 'g');
    
    // We must collect text nodes first to avoid mutating DOM while walking
    const textNodes = [];
    const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null, false);
    
    let node;
    while ((node = walker.nextNode())) {
      // ignore empty or whitespace-only nodes
      if (node.nodeValue.trim().length > 0) {
        textNodes.push(node);
      }
    }

    textNodes.forEach(textNode => {
      const text = textNode.nodeValue;
      if (regex.test(text)) {
        regex.lastIndex = 0; // reset
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
          // text before match
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
          }
          // matched text
          const mark = document.createElement('mark');
          mark.className = 'search-match';
          mark.textContent = match[0];
          this.matches.push(mark);
          fragment.appendChild(mark);

          lastIndex = regex.lastIndex;
        }

        // text after last match
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        if (textNode.parentNode) {
           textNode.parentNode.replaceChild(fragment, textNode);
        }
      }
    });

    if (this.matches.length > 0) {
      this.goTo(0);
    }
    return this.matches.length;
  }

  goTo(index) {
    if (this.matches.length === 0) return;
    
    // reset old active mark
    if (this.currentIndex >= 0 && this.currentIndex < this.matches.length) {
      this.matches[this.currentIndex].classList.remove('current');
    }

    // wrap index
    if (index < 0) index = this.matches.length - 1;
    if (index >= this.matches.length) index = 0;

    this.currentIndex = index;
    const currentMark = this.matches[this.currentIndex];
    currentMark.classList.add('current');

    // Scroll into view safely
    currentMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  next() {
    this.goTo(this.currentIndex + 1);
  }

  prev() {
    this.goTo(this.currentIndex - 1);
  }
}

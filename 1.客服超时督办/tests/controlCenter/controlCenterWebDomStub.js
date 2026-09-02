function createClassListStub(initialClassNames = []) {
  const classes = new Set(initialClassNames);
  return {
    add(...classNames) {
      classNames.forEach((className) => classes.add(className));
    },
    remove(...classNames) {
      classNames.forEach((className) => classes.delete(className));
    },
    toggle(className, force) {
      if (force === true) {
        classes.add(className);
        return true;
      }
      if (force === false) {
        classes.delete(className);
        return false;
      }
      if (classes.has(className)) {
        classes.delete(className);
        return false;
      }
      classes.add(className);
      return true;
    },
    contains(className) {
      return classes.has(className);
    }
  };
}

function createElementStub() {
  return {
    textContent: "",
    className: "",
    disabled: false,
    dataset: {},
    classList: createClassListStub(),
    setAttribute() {},
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    focus() {},
    closest() {
      return null;
    }
  };
}

module.exports = {
  createClassListStub,
  createElementStub
};

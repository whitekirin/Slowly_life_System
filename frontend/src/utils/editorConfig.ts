export const editorConfig = {
  readonly: false,
  placeholder: '請輸入信件內容...',
  height: 300,
  toolbarAdaptive: false,
  showCharsCounter: false,
  showWordsCounter: false,
  showXPathInStatusbar: false,
  buttons: ['source', '|', 'bold', 'italic', 'underline', 'strikethrough', '|', 'font', 'fontsize', 'textColor', 'bgColor', '|', 'ul', 'ol', '|', 'link', 'image', 'align', 'undo', 'redo'],
  controls: {
    textColor: {
      icon: 'pencil',
      tooltip: '變更文字顏色',
      popup: (editor: any, current: any, close: any, button: any) => {
        const originalTab = editor.o.colorPickerDefaultTab;
        editor.o.colorPickerDefaultTab = 'color';
        const popupNode = editor.constructor.defaultOptions.controls.brush.popup(editor, current, close, button);
        const node = popupNode.container || popupNode;
        const buttonsContainer = node.querySelector('.jodit-tabs__buttons');
        if (buttonsContainer) {
          buttonsContainer.style.display = 'none';
        }
        editor.o.colorPickerDefaultTab = originalTab;
        return popupNode;
      }
    },
    bgColor: {
      icon: 'brush',
      tooltip: '變更文字背景顏色',
      popup: (editor: any, current: any, close: any, button: any) => {
        const originalTab = editor.o.colorPickerDefaultTab;
        editor.o.colorPickerDefaultTab = 'background';
        const popupNode = editor.constructor.defaultOptions.controls.brush.popup(editor, current, close, button);
        const node = popupNode.container || popupNode;
        const buttonsContainer = node.querySelector('.jodit-tabs__buttons');
        if (buttonsContainer) {
          buttonsContainer.style.display = 'none';
        }
        editor.o.colorPickerDefaultTab = originalTab;
        return popupNode;
      }
    }
  }
};

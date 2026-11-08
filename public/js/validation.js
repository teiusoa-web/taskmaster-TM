// validation.js - Module kiểm tra tính hợp lệ của Form (Thỏa mãn tiêu chí mục 10)

export const Validation = {
  /**
   * Kiểm tra chuỗi có bị rỗng hay không
   * @param {string} value 
   * @returns {boolean}
   */
  isRequired(value) {
    return value !== null && value !== undefined && value.trim().length > 0;
  },

  /**
   * Kiểm tra độ dài tối thiểu
   * @param {string} value 
   * @param {number} min 
   * @returns {boolean}
   */
  minLength(value, min) {
    return value && value.trim().length >= min;
  },

  /**
   * Kiểm tra định dạng ngày hợp lệ (YYYY-MM-DD)
   * @param {string} dateStr 
   * @returns {boolean}
   */
  isValidDate(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  },

  /**
   * Kiểm tra hạn chót (Deadline) có phải ngày trong tương lai hoặc hôm nay không
   * @param {string} dateStr 
   * @returns {boolean}
   */
  isFutureOrToday(dateStr) {
    if (!this.isValidDate(dateStr)) return false;
    const inputDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return inputDate >= today;
  },

  /**
   * Hiển thị thông báo lỗi ngay dưới thẻ input
   * @param {HTMLElement} inputElement 
   * @param {string} message 
   */
  showError(inputElement, message) {
    inputElement.classList.add('error');
    let errorElem = inputElement.parentElement.querySelector('.error-message');
    if (!errorElem) {
      errorElem = document.createElement('div');
      errorElem.className = 'error-message';
      inputElement.parentElement.appendChild(errorElem);
    }
    errorElem.textContent = message;
    errorElem.classList.add('show');
  },

  /**
   * Xóa thông báo lỗi của ô input
   * @param {HTMLElement} inputElement 
   */
  clearError(inputElement) {
    inputElement.classList.remove('error');
    const errorElem = inputElement.parentElement.querySelector('.error-message');
    if (errorElem) {
      errorElem.textContent = '';
      errorElem.classList.remove('show');
    }
  }
};

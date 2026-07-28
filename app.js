/* app.js - Celestia Inn Premium Interaction Logic */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Header Scroll Effect
  initHeaderScroll();

  // Initialize Scroll Reveal Animations
  initScrollReveal();

  // Initialize Property Portfolio Filter
  initPropertyFilter();

  // Initialize Experience Guide
  initExperienceGuide();

  // Initialize Partnership Form Submission
  initPartnershipForm();

  // Initialize Mobile Drawer Navigation
  initMobileDrawer();
});

/**
 * Handle glass navbar transition on scroll
 */
function initHeaderScroll() {
  const header = document.getElementById('header-nav');
  if (!header) return;

  const handleScroll = () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };

  // Run on load and on scroll
  handleScroll();
  window.addEventListener('scroll', handleScroll);
}

/**
 * Trigger fade-in and slide-up animations as elements enter the viewport
 */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length === 0) return;

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        // Once animated, we don't need to observe it anymore
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px' // Trigger slightly before element is fully visible
  });

  reveals.forEach(reveal => {
    revealObserver.observe(reveal);
  });
}

/**
 * Handle filtering of the property portfolio grid
 */
function initPropertyFilter() {
  const tabs = document.querySelectorAll('.portfolio-tab');
  const cards = document.querySelectorAll('.portfolio-card');
  if (tabs.length === 0 || cards.length === 0) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      tab.classList.add('active');

      const filterValue = tab.getAttribute('data-filter');

      cards.forEach(card => {
        const cardCategory = card.getAttribute('data-category');

        // First transition card scale/opacity down
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95) translateY(10px)';
        
        setTimeout(() => {
          if (filterValue === 'all' || cardCategory === filterValue) {
            card.style.display = 'flex';
            // Trigger reflow to apply transition
            card.offsetHeight;
            card.style.opacity = '1';
            card.style.transform = 'scale(1) translateY(0)';
          } else {
            card.style.display = 'none';
          }
        }, 300);
      });
    });
  });
}

/**
 * Handle validation and dynamic submit response of the owner inquiry form
 */
function initPartnershipForm() {
  const form = document.getElementById('partnership-form');
  const submitBtn = document.getElementById('submit-btn');
  const successOverlay = document.getElementById('success-overlay');
  const tabBtns = document.querySelectorAll('.form-tab-btn');
  
  if (!form || !submitBtn || !successOverlay) return;

  let activeTab = 'booking'; // Default active tab

  // Handle Form Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all form tabs
      tabBtns.forEach(b => b.classList.remove('active'));
      // Add active class to clicked tab
      btn.classList.add('active');

      activeTab = btn.getAttribute('data-tab');
      
      const bookingFields = document.getElementById('form-fields-booking');
      const leasingFields = document.getElementById('form-fields-leasing');
      const formTitle = document.getElementById('form-container-title');
      const formNote = document.getElementById('form-note-text');

      if (activeTab === 'booking') {
        bookingFields.style.display = 'block';
        leasingFields.style.display = 'none';
        formTitle.textContent = 'Book a Stay';
        submitBtn.textContent = 'Submit Booking Inquiry';
        formNote.textContent = 'By submitting this form, you authorize Celestia Inn LLP to contact you regarding bookings.';
      } else {
        bookingFields.style.display = 'none';
        leasingFields.style.display = 'block';
        formTitle.textContent = 'Lease Your Property';
        submitBtn.textContent = 'Submit Lease Inquiry';
        formNote.textContent = 'By submitting this form, you authorize Celestia Inn LLP to contact you regarding property partnerships.';
      }
    });
  });

  // Handle Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Fetch field values
    const nameInput = document.getElementById('name');
    const contactInput = document.getElementById('contact');
    const name = nameInput ? nameInput.value.trim() : '';
    const contact = contactInput ? contactInput.value.trim() : '';

    // Validate shared fields
    if (!name || !contact) {
      alert('Please fill out all contact fields.');
      return;
    }

    // Phone number format validation (minimum digits checked)
    const phoneDigits = contact.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      alert('Please enter a valid contact number.');
      return;
    }

    // Tab-specific validation
    if (activeTab === 'booking') {
      const dateInput = document.getElementById('check-in-date');
      if (dateInput && !dateInput.value) {
        alert('Please select a check-in date.');
        return;
      }
      // Date in past check
      if (dateInput && dateInput.value) {
        const today = new Date();
        today.setHours(0,0,0,0);
        const selectedDate = new Date(dateInput.value);
        if (selectedDate < today) {
          alert('Check-in date cannot be in the past.');
          return;
        }
      }
    } else {
      const locationInput = document.getElementById('location');
      const location = locationInput ? locationInput.value.trim() : '';
      if (!location) {
        alert('Please specify your property location.');
        return;
      }
    }

    // Update button to show processing state
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <svg class="spinner" width="16" height="16" viewBox="0 0 50 50" style="animation: rotate 1s linear infinite;">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" style="stroke-dasharray: 80, 200; stroke-dashoffset: 0;"></circle>
        </svg>
        Processing...
      </span>
    `;

    // Inject temporary CSS rotation for spinner if not present
    if (!document.getElementById('spinner-style')) {
      const style = document.createElement('style');
      style.id = 'spinner-style';
      style.innerHTML = `
        @keyframes rotate { 100% { transform: rotate(360deg); } }
      `;
      document.head.appendChild(style);
    }

    // Prepare Web3Forms payload
    const accessKey = window.WEB3FORMS_ACCESS_KEY || 'e1e750b2-ae69-4dd8-a683-1c88ea7e1538';
    const payload = {
      access_key: accessKey,
      subject: activeTab === 'booking' ? 'New Booking Inquiry - Celestia Inn' : 'New Property Lease Proposal - Celestia Inn',
      from_name: 'Celestia Inn Website',
      "Full Name": name,
      "Contact Number": contact,
      "Form Type": activeTab === 'booking' ? 'Stay Booking' : 'Property Leasing'
    };

    if (activeTab === 'booking') {
      const staySelect = document.getElementById('stay-destination');
      const dateInput = document.getElementById('check-in-date');
      const guestSelect = document.getElementById('guest-count');
      if (staySelect) payload["Destination"] = staySelect.options[staySelect.selectedIndex].text;
      if (dateInput) payload["Check-in Date"] = dateInput.value;
      if (guestSelect) payload["Guest Count"] = guestSelect.value;
    } else {
      const locationInput = document.getElementById('location');
      const propertyType = document.getElementById('property-type');
      const leaseTerm = document.getElementById('lease-term');
      if (locationInput) payload["Property Location"] = locationInput.value;
      if (propertyType) payload["Property Type"] = propertyType.value;
      if (leaseTerm) payload["Lease Duration"] = leaseTerm.value;
    }

    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const resData = await response.json();
      if (!resData.success) {
        console.warn('Web3Forms dispatch warning:', resData.message);
      }
    } catch (err) {
      console.error('Email service dispatch error:', err);
    }

    // Clear inputs
    if (nameInput) nameInput.value = '';
    if (contactInput) contactInput.value = '';
    
    const dateInput = document.getElementById('check-in-date');
    if (dateInput) dateInput.value = '';
    
    const locationInput = document.getElementById('location');
    if (locationInput) locationInput.value = '';

    // Update success overlay text dynamically
    const successTitle = document.getElementById('success-overlay-title');
    const successDesc = document.getElementById('success-overlay-desc');
    const resetBtn = document.getElementById('reset-form-btn');

    if (activeTab === 'booking') {
      successTitle.textContent = 'Booking Request Received';
      successDesc.textContent = 'Thank you for choosing Celestia Inn! Our reservation host will contact you shortly to coordinate your stay and confirm availability.';
      if (resetBtn) resetBtn.textContent = 'Make Another Booking';
    } else {
      successTitle.textContent = 'Lease Proposal Received';
      successDesc.textContent = 'Thank you for contacting Celestia Inn LLP. Our regional property acquisition manager will evaluate your details and reach out within 24 hours.';
      if (resetBtn) resetBtn.textContent = 'Submit Another Property';
    }

    // Reset button
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;

    // Show success overlay
    successOverlay.classList.add('active');
  });

  // Enable resetting form success overlay
  const resetBtn = document.getElementById('reset-form-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      successOverlay.classList.remove('active');
    });
  }
}

/**
 * Handle mobile navigation drawer toggling
 */
function initMobileDrawer() {
  const openBtn = document.getElementById('mobile-menu-open');
  const closeBtn = document.getElementById('mobile-menu-close');
  const drawer = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const drawerLinks = document.querySelectorAll('.mobile-nav-link');

  if (!drawer || !backdrop) return;

  const openDrawer = () => {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden'; // Disable scroll on body
  };

  const closeDrawer = () => {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = ''; // Enable scroll on body
  };

  if (openBtn) openBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  // Close drawer when a link is clicked
  drawerLinks.forEach(link => {
    link.addEventListener('click', closeDrawer);
  });
}

/**
 * Handle interactive tab switching and image/details swap for the Shangarh Experience Guide
 */
function initExperienceGuide() {
  const tabs = document.querySelectorAll('.experience-tab');
  const previewImg = document.getElementById('exp-preview-img');
  const previewTitle = document.getElementById('exp-preview-title');
  const previewDesc = document.getElementById('exp-preview-desc');
  const badgeDuration = document.getElementById('exp-badge-duration');
  const badgeDifficulty = document.getElementById('exp-badge-difficulty');
  const previewContent = document.querySelector('.preview-content');

  if (tabs.length === 0 || !previewImg) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // If already active, do nothing
      if (tab.classList.contains('active')) return;

      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Add active class to selected tab
      tab.classList.add('active');

      // Fetch parameters
      const title = tab.getAttribute('data-title');
      const desc = tab.getAttribute('data-desc');
      const duration = tab.getAttribute('data-duration');
      const difficulty = tab.getAttribute('data-difficulty');
      const imgUrl = tab.getAttribute('data-img');

      // Apply fade-out animation to preview elements
      previewImg.classList.add('fade-out');
      if (previewContent) previewContent.classList.add('fade-out');

      // Swap content after fade-out transition delay
      setTimeout(() => {
        previewImg.src = imgUrl;
        previewImg.alt = title;
        if (previewTitle) previewTitle.textContent = title;
        if (previewDesc) previewDesc.textContent = desc;

        // Update badges with appropriate HTML icons
        if (badgeDuration) {
          badgeDuration.innerHTML = `<span class="material-symbols-outlined inline-icon">schedule</span>${duration}`;
        }
        if (badgeDifficulty) {
          badgeDifficulty.innerHTML = `<span class="material-symbols-outlined inline-icon">bar_chart</span>${difficulty}`;
        }

        // Fade back in
        previewImg.classList.remove('fade-out');
        if (previewContent) previewContent.classList.remove('fade-out');
      }, 400);

    });
  });
}




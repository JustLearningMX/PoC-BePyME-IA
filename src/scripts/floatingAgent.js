/**
 * Banorte Premium Floating Agent Management Script
 */
document.addEventListener("DOMContentLoaded", () => {
    const triggerWrap = document.querySelector(".floating-ai-trigger-wrap");
    const triggerBtn = document.getElementById("floating-trigger");
    const defaultChatPanel = document.getElementById("default-chat-panel");
    const customChatPanel = document.getElementById("custom-chat-panel");
    const btnSelectDefault = document.getElementById("btn-select-default");
    const btnSelectCustom = document.getElementById("btn-select-custom");
    const closeBtns = document.querySelectorAll(".chat-close-btn");

    // Toggle Floating Menu
    triggerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerWrap.classList.toggle("menu-open");
    });

    // Close menu when clicking anywhere else
    document.addEventListener("click", () => {
        if (triggerWrap.classList.contains("menu-open")) {
            triggerWrap.classList.remove("menu-open");
        }
    });

    // Toggle default Qlik-Embed assistant
    btnSelectDefault.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerWrap.classList.remove("menu-open");

        // Close Custom if open
        customChatPanel.classList.remove("active");

        // Toggle Default Chat Panel
        defaultChatPanel.classList.toggle("active");
    });

    // Toggle custom-designed assistant
    btnSelectCustom.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerWrap.classList.remove("menu-open");

        // Close Default if open
        defaultChatPanel.classList.remove("active");

        // Toggle Custom Chat Panel
        customChatPanel.classList.toggle("active");
    });

    // Close buttons on panel headers
    closeBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const panel = btn.closest(".floating-chat-panel");
            if (panel) {
                panel.classList.remove("active");
            }
        });
    });

    // Stop propagation inside floating chat panels so clicking in them doesn't close anything unexpected
    defaultChatPanel.addEventListener("click", (e) => e.stopPropagation());
    customChatPanel.addEventListener("click", (e) => e.stopPropagation());
});

import { MODULE_SHORT } from '../module/const.js';
import { TEMPLATE } from '../module/templates.js';
import { CoreUtility } from './core.js';
import { LogUtility } from './log.js';
import { RenderUtility } from './render.js';
import { RollUtility } from './roll.js';
import { ChatUtility } from './chat.js';

/**
 * Utility class to handle dice rerolling functionality for damage rolls.
 */
export class RerollUtility {
    /**
     * Shows the reroll damage selection dialog.
     * @param {ChatMessage} message The chat message containing damage rolls.
     * @param {Event} event The originating click event.
     */
    static async showRerollDialog(message, event) {
        try {
            // Extract dice data from damage rolls
            const diceGroups = RerollUtility._extractDiceDataFromMessage(message);

            if (diceGroups.length === 0) {
                ui.notifications.warn(CoreUtility.localize('rsr5e.reroll.noDiceFound'));
                return;
            }

            // Render the modal content
            const content = await RenderUtility.render(TEMPLATE.REROLL_MODAL, {
                diceGroups,
            });

            // Create dialog options
            const dialogOptions = {
                width: 400,
                height: 'auto',
                top: event ? event.clientY - 100 : null,
                left: event ? event.clientX - 200 : null,
                classes: ['rsr-reroll-dialog', 'rsr-reroll-modal'],
            };

            // Create the dialog
            const dialog = new Dialog(
                {
                    title: CoreUtility.localize('rsr5e.reroll.dialogTitle'),
                    content: content,
                    buttons: {
                        reroll: {
                            icon: '<i class="fa-solid fa-arrows-rotate"></i>',
                            label: CoreUtility.localize('rsr5e.reroll.rerollSelected'),
                            callback: async html => {
                                await RerollUtility._handleRerollConfirm(message, html);
                            },
                        },
                        cancel: {
                            icon: '<i class="fa-solid fa-xmark"></i>',
                            label: CoreUtility.localize('Cancel'),
                            callback: () => {}, // Do nothing on cancel
                        },
                    },
                    default: 'reroll',
                    render: html => {
                        RerollUtility._setupDialogListeners(html);
                    },
                },
                dialogOptions
            );

            dialog.render(true);
        } catch (error) {
            LogUtility.logError('Failed to show reroll damage dialog:', error);
            ui.notifications.error(CoreUtility.localize('rsr5e.reroll.dialogError'));
        }
    }

    /**
     * Extracts dice data from damage rolls for the reroll dialog.
     * @param {ChatMessage} message The chat message containing damage rolls.
     * @returns {Array} Array of dice group data for the dialog.
     * @private
     */
    static _extractDiceDataFromMessage(message) {
        const diceGroups = [];
        const damageRolls = message.rolls.filter(r => r instanceof CONFIG.Dice.DamageRoll);

        console.log(`RSR Debug: Found ${damageRolls.length} damage rolls in message`, damageRolls);

        // Track processed dice to avoid duplicates
        const processedDice = new Set();

        damageRolls.forEach((roll, rollIndex) => {
            const dieTerms = roll.terms.filter(term => term instanceof foundry.dice.terms.Die);
            console.log(`RSR Debug: Roll ${rollIndex} has ${dieTerms.length} die terms`, dieTerms);

            dieTerms.forEach((term, termIndex) => {
                // Create unique identifier for this die term
                const termKey = `${rollIndex}-${termIndex}-${term.faces}-${term.number}`;

                if (processedDice.has(termKey)) {
                    console.log(`RSR Debug: Skipping duplicate die term: ${termKey}`);
                    return;
                }
                processedDice.add(termKey);

                // Try to determine damage type from roll options or formula
                const damageType = RerollUtility._getDamageTypeFromTerm(roll, termIndex);

                const results = term.results
                    .map((result, index) => {
                        const classes = [];
                        if (result.result === term.faces) classes.push('max');
                        if (result.result === 1) classes.push('min');

                        return {
                            index: index,
                            result: result.result,
                            active: result.active !== false,
                            classes: classes.join(' '),
                        };
                    })
                    .filter(r => r.active); // Only show active results

                // Sort results from lowest to highest
                results.sort((a, b) => a.result - b.result);

                if (results.length > 0) {
                    console.log(`RSR Debug: Adding dice group for d${term.faces} with ${results.length} results`);
                    diceGroups.push({
                        rollIndex: rollIndex,
                        termIndex: termIndex,
                        faces: term.faces,
                        rollCount: term.number,
                        damageType: damageType,
                        results: results,
                    });
                }
            });
        });

        // Sort groups by die type (d4, d6, d8, etc.) then by damage type
        diceGroups.sort((a, b) => {
            if (a.faces !== b.faces) {
                return a.faces - b.faces;
            }
            const typeA = a.damageType || 'zzz'; // Put untyped at the end
            const typeB = b.damageType || 'zzz';
            return typeA.localeCompare(typeB);
        });

        console.log(`RSR Debug: Final dice groups:`, diceGroups);
        return diceGroups;
    }

    /**
     * Attempts to determine damage type from roll term context.
     * @param {DamageRoll} roll The damage roll.
     * @param {number} termIndex The index of the term.
     * @returns {string|null} The damage type if found.
     * @private
     */
    static _getDamageTypeFromTerm(roll, termIndex) {
        // This is a simplified implementation - in practice you might need more sophisticated parsing
        if (roll.options?.type) {
            return roll.options.type;
        }

        // Try to extract from roll formula or options
        if (roll.terms && roll.terms[termIndex + 1] && roll.terms[termIndex + 1].term) {
            return roll.terms[termIndex + 1].term;
        }

        return null;
    }

    /**
     * Sets up event listeners for the reroll dialog.
     * @param {jQuery} html The dialog HTML element.
     * @private
     */
    static _setupDialogListeners(html) {
        // Update selected count when checkboxes change
        html.find('input[name="reroll-die"]').on('change', function () {
            const selectedCount = html.find('input[name="reroll-die"]:checked').length;
            html.find('.selected-count').text(selectedCount);
        });

        // Quick select options
        html.find('#reroll-ones').on('change', function () {
            const checked = this.checked;
            html.find('input[name="reroll-die"]').each(function () {
                const result = parseInt($(this).data('die-result'));
                if (result === 1) {
                    $(this).prop('checked', checked);
                }
            });
            // Trigger change to update count
            html.find('input[name="reroll-die"]').first().trigger('change');
        });
    }

    /**
     * Handles the reroll confirmation from the dialog.
     * @param {ChatMessage} message The original chat message.
     * @param {jQuery} html The dialog HTML element.
     * @private
     */
    static async _handleRerollConfirm(message, html) {
        try {
            // Collect selected dice data
            const selectedDice = [];

            html.find('input[name="reroll-die"]:checked').each(function () {
                const $this = $(this);
                selectedDice.push({
                    rollIndex: parseInt($this.data('roll-index')),
                    termIndex: parseInt($this.data('term-index')),
                    dieIndex: parseInt($this.data('die-index')),
                    currentResult: parseInt($this.data('die-result')),
                });
            });

            if (selectedDice.length === 0) {
                ui.notifications.warn(CoreUtility.localize('rsr5e.reroll.noDiceSelected'));
                return;
            }

            // Get the keep option (default to "new")
            const keepOption = html.find('input[name="keep-option"]:checked').val() || 'new';

            LogUtility.log('Rerolling dice:', selectedDice);

            // Group dice by roll and term for efficient processing
            const rerollsByRoll = RerollUtility._groupRerollsByRoll(selectedDice);
            const newRolls = [];

            // Process each damage roll that has dice to reroll
            for (const [rollIndex, terms] of Object.entries(rerollsByRoll)) {
                const rollIdx = parseInt(rollIndex);
                const originalRoll = message.rolls.filter(r => r instanceof CONFIG.Dice.DamageRoll)[rollIdx];

                if (!originalRoll) {
                    LogUtility.logError(`Could not find damage roll at index ${rollIdx}`);
                    continue;
                }

                // Create new rolls for each die that needs rerolling
                for (const [termIndex, diceIndices] of Object.entries(terms)) {
                    const termIdx = parseInt(termIndex);
                    const originalTerm = originalRoll.terms.filter(t => t instanceof foundry.dice.terms.Die)[termIdx];

                    if (!originalTerm) {
                        LogUtility.logError(`Could not find die term at index ${termIdx} in roll ${rollIdx}`);
                        continue;
                    }

                    // Create a new roll for just the dice being rerolled
                    const rerollCount = diceIndices.length;
                    const rerollFormula = `${rerollCount}d${originalTerm.faces}`;
                    const rerollRoll = new Roll(rerollFormula);

                    await rerollRoll.evaluate();
                    newRolls.push(rerollRoll);

                    // Store old results and replace with new ones based on keep option
                    diceIndices.forEach((dieIndex, i) => {
                        if (i < rerollRoll.dice[0].results.length) {
                            const oldResult = originalTerm.results[dieIndex];
                            const newResult = rerollRoll.dice[0].results[i];

                            let finalResult = newResult.result;

                            // Apply keep option logic
                            if (keepOption === 'better') {
                                finalResult = Math.max(oldResult.result, newResult.result);
                            }
                            // If keepOption === "new", we use newResult.result (already set above)

                            // Store the old result value and replace with final result
                            originalTerm.results[dieIndex] = {
                                result: finalResult,
                                active: true,
                                rerolled: false,
                                oldResult: oldResult.result, // Store the old value for display
                                newResult: newResult.result, // Store the new roll result for audit
                                wasRerolled: true, // Mark this as having been rerolled
                                keepOption: keepOption, // Store which option was used
                            };
                        }
                    });
                }

                // Reset roll calculations after modifying results
                RollUtility.resetRollGetters(originalRoll);
            }

            // Trigger Dice3D animation for the new rolls if available
            if (newRolls.length > 0) {
                await CoreUtility.tryRollDice3D(newRolls);
            }

            // Update the chat message with the modified rolls
            await ChatUtility.updateChatMessage(message, {
                rolls: message.rolls,
            });

            // Create audit log chat message
            await RerollUtility._createAuditLog(message, selectedDice, newRolls, keepOption);

            // Play roll sound if Dice3D is not enabled
            if (!game.dice3d || !game.dice3d.isEnabled()) {
                CoreUtility.playRollSound();
            }

            // Show success notification
            ui.notifications.info(
                CoreUtility.localize('rsr5e.reroll.success', {
                    count: selectedDice.length,
                })
            );
        } catch (error) {
            LogUtility.logError('Failed to reroll damage dice:', error);
            ui.notifications.error(CoreUtility.localize('rsr5e.reroll.error'));
        }
    }

    /**
     * Groups selected dice by roll index and term index for efficient processing.
     * @param {Array} selectedDice Array of selected dice data.
     * @returns {Object} Grouped data structure.
     * @private
     */
    static _groupRerollsByRoll(selectedDice) {
        const grouped = {};

        selectedDice.forEach(die => {
            if (!grouped[die.rollIndex]) {
                grouped[die.rollIndex] = {};
            }
            if (!grouped[die.rollIndex][die.termIndex]) {
                grouped[die.rollIndex][die.termIndex] = [];
            }
            grouped[die.rollIndex][die.termIndex].push(die.dieIndex);
        });

        return grouped;
    }

    /**
     * Creates an audit log chat message showing the reroll details.
     * @param {ChatMessage} originalMessage The original message that was rerolled.
     * @param {Array} selectedDice The dice that were selected for reroll.
     * @param {Array} newRolls The new rolls that were made.
     * @param {string} keepOption The keep option that was used ('better' or 'new').
     * @private
     */
    static async _createAuditLog(originalMessage, selectedDice, newRolls, keepOption) {
        try {
            // Group dice by their details for cleaner display
            const rerollSummary = RerollUtility._buildSummary(originalMessage, selectedDice, newRolls);

            // Determine keep option display text
            const keepOptionText = keepOption === 'better' ? 'Keep Better' : 'Keep New';
            const keepOptionIcon = keepOption === 'better' ? 'fa-arrow-up' : 'fa-arrow-right';

            // Create the audit log content
            const content = `
                <div class="rsr-reroll-audit">
                    <h3><i class="fa-solid fa-arrows-rotate"></i> Damage Dice Rerolled</h3>
                    <div class="rsr-audit-keep-option">
                        <strong><i class="fa-solid ${keepOptionIcon}"></i> ${keepOptionText}</strong>
                    </div>
                    <div class="rsr-audit-details">
                        <table class="rsr-audit-table">
                            <thead>
                                <tr>
                                    <th>Die</th>
                                    <th>Old</th>
                                    <th>New</th>
                                    <th>Final</th>
                                    <th>Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rerollSummary
                                    .map(
                                        entry => `
                                    <tr class="${entry.change > 0 ? 'positive' : entry.change < 0 ? 'negative' : 'neutral'}">
                                        <td>d${entry.faces}</td>
                                        <td>${entry.oldResult}</td>
                                        <td>${entry.newRoll}</td>
                                        <td class="${entry.keptBetter ? 'kept-better' : 'kept-new'}">${entry.finalResult}</td>
                                        <td>${entry.change > 0 ? '+' : ''}${entry.change}</td>
                                    </tr>
                                `
                                    )
                                    .join('')}
                            </tbody>
                        </table>
                        <div class="rsr-audit-totals">
                            <strong>Total Change:</strong> ${rerollSummary.reduce((sum, entry) => sum + entry.change, 0) > 0 ? '+' : ''}${rerollSummary.reduce(
                (sum, entry) => sum + entry.change,
                0
            )}
                        </div>
                    </div>
                </div>
            `;

            // Create the chat message
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker(),
                content: content,
                type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                flags: {
                    [MODULE_SHORT]: {
                        isRerollAudit: true,
                        originalMessageId: originalMessage.id,
                    },
                },
            });
        } catch (error) {
            LogUtility.logError('Failed to create reroll audit log:', error);
        }
    }

    /**
     * Builds a summary of reroll changes for the audit log.
     * @param {ChatMessage} originalMessage The original message.
     * @param {Array} selectedDice The selected dice data.
     * @param {Array} newRolls The new rolls made.
     * @returns {Array} Summary data for display.
     * @private
     */
    static _buildSummary(originalMessage, selectedDice, newRolls) {
        const summary = [];
        const damageRolls = originalMessage.rolls.filter(r => r instanceof CONFIG.Dice.DamageRoll);

        selectedDice.forEach(die => {
            const roll = damageRolls[die.rollIndex];
            if (!roll) return;

            const term = roll.terms.filter(t => t instanceof foundry.dice.terms.Die)[die.termIndex];
            if (!term) return;

            const result = term.results[die.dieIndex];
            if (!result || !result.wasRerolled) return;

            // Determine if the better result was kept
            const keptBetter = result.keepOption === 'better' && result.result === Math.max(result.oldResult, result.newResult);

            summary.push({
                faces: term.faces,
                oldResult: result.oldResult,
                newRoll: result.newResult,
                finalResult: result.result,
                change: result.result - result.oldResult,
                keptBetter: keptBetter,
                keepOption: result.keepOption,
            });
        });

        return summary;
    }
}
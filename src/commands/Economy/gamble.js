import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const BASE_WIN_CHANCE = 0.4;
const CLOVER_WIN_BONUS = 0.1;
const CHARM_WIN_BONUS = 0.08;
const PAYOUT_MULTIPLIER = 2.0;
const GAMBLE_COOLDOWN = 5 * 60 * 1000;

export default {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Joue ton argent pour avoir une chance d’en gagner davantage')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Montant d’argent à miser')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const betAmount = interaction.options.getInteger("amount");
            const now = Date.now();

            const userData = await getEconomyData(client, guildId, userId);
            const lastGamble = userData.lastGamble || 0;
            let cloverCount = userData.inventory["lucky_clover"] || 0;
            let charmCount = userData.inventory["lucky_charm"] || 0;

            if (now < lastGamble + GAMBLE_COOLDOWN) {
                const remaining = lastGamble + GAMBLE_COOLDOWN - now;
                const minutes = Math.floor(remaining / (1000 * 60));
                const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

                throw createError(
                    "Temps de recharge du pari actif",
                    ErrorTypes.RATE_LIMIT,
                    `Tu dois attendre avant de pouvoir rejouer. Réessaie dans **${minutes}m ${seconds}s**.`,
                    { remaining, cooldownType: 'gamble' }
                );
            }

            if (userData.wallet < betAmount) {
                throw createError(
                    "Argent insuffisant pour parier",
                    ErrorTypes.VALIDATION,
                    `Tu n'as que **$${userData.wallet.toLocaleString()}** en liquide, mais tu essaies de miser **$${betAmount.toLocaleString()}**.`,
                    { required: betAmount, current: userData.wallet }
                );
            }

            let winChance = BASE_WIN_CHANCE;
            let cloverMessage = "";
            let usedClover = false;
            let usedCharm = false;

            if (cloverCount > 0) {
                winChance += CLOVER_WIN_BONUS;
                userData.inventory["lucky_clover"] -= 1;
                cloverMessage = `\n🍀 **Trèfle Porte-Bonheur consommé :** Tes chances de gagner ont été augmentées !`;
                usedClover = true;
            }
            
            else if (charmCount > 0) {
                winChance += CHARM_WIN_BONUS;
                userData.inventory["lucky_charm"] -= 1;
                cloverMessage = `\n🍀 **Porte-Bonheur utilisé (${charmCount - 1} utilisations restantes) :** Tes chances de gagner ont été augmentées !`;
                usedCharm = true;
            }

            const win = Math.random() < winChance;
            let cashChange = 0;
            let resultEmbed;

            if (win) {
                const amountWon = Math.floor(betAmount * PAYOUT_MULTIPLIER);
cashChange = amountWon;

                resultEmbed = successEmbed(
                    "🎉 Tu as gagné !",
                    `Tu as réussi ton pari et transformé ta mise de **$${betAmount.toLocaleString()}** en **$${amountWon.toLocaleString()}** !${cloverMessage}`,
                );
            } else {
cashChange = -betAmount;

                resultEmbed = warningEmbed(
                    "💔 Tu as perdu...",
                    `Les dés n'ont pas été de ton côté. Tu as perdu ta mise de **$${betAmount.toLocaleString()}**.`,
                );
            }

            userData.wallet = (userData.wallet || 0) + cashChange;
userData.lastGamble = now;

            await setEconomyData(client, guildId, userId, userData);

            const newCash = userData.wallet;

            resultEmbed.addFields({
                name: "Nouveau solde en liquide",
                value: `$${newCash.toLocaleString()}`,
                inline: true,
            });

            if (usedClover) {
                resultEmbed.setFooter({
                    text: `Il te reste ${userData.inventory["lucky_clover"]} Trèfles Porte-Bonheur. Tes chances de gagner étaient de ${Math.round(winChance * 100)}%.`,
                });
            } else if (usedCharm) {
                resultEmbed.setFooter({
                    text: `Il te reste ${userData.inventory["lucky_charm"]} utilisations du Porte-Bonheur. Tes chances de gagner étaient de ${Math.round(winChance * 100)}%.`,
                });
            } else {
                resultEmbed.setFooter({
                    text: `Prochain pari disponible dans 5 minutes. Chances de victoire de base : ${Math.round(BASE_WIN_CHANCE * 100)}%.`,
                });
            }

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'gamble' })
};

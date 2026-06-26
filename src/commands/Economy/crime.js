import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const CRIME_COOLDOWN = 60 * 60 * 1000;
const MIN_CRIME_AMOUNT = 100;
const MAX_CRIME_AMOUNT = 2000;
const FAILURE_RATE = 0.4;
const JAIL_TIME = 2 * 60 * 60 * 1000;

const CRIME_TYPES = [
    { name: "Vol à la tire", min: 100, max: 500, risk: 0.3 },
    { name: "Cambriolage", min: 300, max: 1000, risk: 0.4 },
    { name: "Braquage de banque", min: 1000, max: 5000, risk: 0.6 },
    { name: "Vol d'œuvre d'art", min: 2000, max: 10000, risk: 0.7 },
    { name: "Cybercriminalité", min: 5000, max: 20000, risk: 0.8 },
];

export default {
    data: new SlashCommandBuilder()
        .setName('crime')
        .setDescription('Commettez un crime pour gagner de l’argent (risqué)')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Type de crime à commettre')
                .setRequired(true)
                .addChoices(
                    { name: 'Vol à la tire', value: 'pickpocketing' },
                    { name: 'Cambriolage', value: 'burglary' },
                    { name: 'Braquage de banque', value: 'bank-heist' },
                    { name: "Vol d'œuvre d'art", value: 'art-theft' },
                    { name: 'Cybercriminalité', value: 'cybercrime' },
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const userData = await getEconomyData(client, guildId, userId);
            const lastCrime = userData.cooldowns?.crime || 0;
            const isJailed = userData.jailedUntil && userData.jailedUntil > now;

            if (isJailed) {
                const timeLeft = Math.ceil((userData.jailedUntil - now) / (1000 * 60));
                throw createError(
                    "L'utilisateur est en prison",
                    ErrorTypes.RATE_LIMIT,
                    `Vous êtes en prison pour encore ${timeLeft} minute(s) !`,
                    { jailTimeRemaining: userData.jailedUntil - now }
                );
            }

            if (now < lastCrime + CRIME_COOLDOWN) {
                const timeLeft = Math.ceil((lastCrime + CRIME_COOLDOWN - now) / (1000 * 60));
                throw createError(
                    "Temps de recharge du crime actif",
                    ErrorTypes.RATE_LIMIT,
                    `Vous devez attendre encore ${timeLeft} minute(s) avant de commettre un autre crime.`,
                    { remaining: lastCrime + CRIME_COOLDOWN - now, cooldownType: 'crime' }
                );
            }

            const crimeType = interaction.options.getString("type").toLowerCase();
            const crime = CRIME_TYPES.find(
                c => c.name.toLowerCase().replace(/\s+/g, '-') === crimeType
            );

            if (!crime) {
                throw createError(
                    "Type de crime invalide",
                    ErrorTypes.VALIDATION,
                    "Veuillez sélectionner un type de crime valide.",
                    { crimeType }
                );
            }

            const isSuccess = Math.random() > crime.risk;
            const amountEarned = isSuccess
                ? Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min
                : 0;

            userData.cooldowns = userData.cooldowns || {};
            userData.cooldowns.crime = now;

            if (isSuccess) {
                userData.wallet = (userData.wallet || 0) + amountEarned;
                
                await setEconomyData(client, guildId, userId, userData);
                
                const embed = successEmbed(
                    "🕵️ Crime réussi !",
                    `Vous avez réussi un(e) ${crime.name} et gagné **${amountEarned}** pièces !`
                );
                
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } else {
                const fine = Math.floor(amountEarned * 0.2);
                userData.wallet = Math.max(0, (userData.wallet || 0) - fine);
                userData.jailedUntil = now + JAIL_TIME;
                
                await setEconomyData(client, guildId, userId, userData);
                
                const embed = warningEmbed(
                    "🚔 Crime échoué !",
                    `Vous avez été arrêté pendant votre ${crime.name} et envoyé en prison !` +
                    ` Vous avez reçu une amende de ${fine} pièces et resterez en prison pendant 2 heures.`
                );
                
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            }
    }, { command: 'crime' })
};

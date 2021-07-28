import { PlayerInfo, TankTacticsGame } from "./TankTactics";
import db from "./db";
import * as Discord from "discord.js";
import { config } from "dotenv";
import { createCanvas, loadImage } from "canvas";

const prefix = "!";

config();
const client = new Discord.Client({
	partials: ["MESSAGE", "REACTION"],
});

process.on("uncaughtException", (err) => {
	console.log("Caught exception", err);
});

const getApp = (guildId) => {
	// @ts-ignore
	const app = client.api.applications(client.user.id);
	if (guildId) {
		app.guilds(guildId);
	}
	return app;
};
const playerImages = {};

const games: TankTacticsGame[] = db
	.get("games")
	.map((g) => new TankTacticsGame(g));

function doGameListeners() {
	for (let game of games) {
		game.eventListeners = game.eventListeners.filter((v) => v.callback);
		if (game.eventListeners.length === 0)
			game.on("points-given", async () => {
				// @ts-ignore
				const channels = await getAllChannels();
				let gameChannel = channels.find((c) => c.name === game.name);

				console.log(channels);
				const c = await client.channels.fetch(gameChannel.id);

				// @ts-ignore
				await c.send(
					"**Everybody in this match has received a single action point.**"
				);
				sendToDiscord(game);
			});
	}
}

client.on("ready", async () => {
	console.log(`Logged in as ${client.user.tag}!`);

	doGameListeners();

	await installCommands();

	// @ts-ignore
	client.ws.on("INTERACTION_CREATE", async (interaction) => {
		const slashCommandName = interaction.data.name;
		const channel = await client.channels.cache.get(interaction.channel_id);

		// @ts-ignore
		console.log(channel.name, slashCommandName);

		// @ts-ignore
		const game = games.find((g) => g.name === channel.name);

		const reply = (content) => {
			console.log(`Replying at ${new Date().toLocaleString()}: ${content}`);
			try {
				// @ts-ignore
				client.api
					// @ts-ignore
					.interactions(interaction.id, interaction.token)
					.callback.post({
						data: {
							type: 4,
							data: {
								content,
							},
						},
					});
			} catch (err) {
				// Oh well
			}
		};

		if (!game) {
			reply("Wtf flik je me nou?! Je moet t wel in n game kanaal doen man wtf");
			return;
		}

		const tag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
		const player = game.players.find((v) => v.name === tag);

		if (!player) {
			reply("Jij bent niet eens een speler wtf");
			return;
		}

		switch (slashCommandName) {
			case "ping": {
				reply("Bruh");
				break;
			}
			case "walk": {
				console.log(interaction.data.options);
				const directionObj = interaction.data.options.find(
					(v) => v.name === "direction"
				);
				const stepCount = Number(
					interaction.data.options.find((v) => v.name === "step_count")
						?.value || "1"
				);
				const desiredDirection = directionObj.value;

				const walkRes = game.walkPlayer(player.id, desiredDirection, stepCount);

				if (walkRes !== "ok") {
					reply(walkRes);
					sendToDiscord(game);
					return;
				}

				reply(`Veel plezier daar ${desiredDirection}`);
				sendToDiscord(game);
				break;
			}
			case "board": {
				reply("Zonder twijfel broski");
				sendToDiscord(game);
				break;
			}
			case "attack": {
				const victimId = interaction.data.options.find(
					(v) => v.name === "victim"
				).value;
				const member = await client.users.fetch(victimId);
				const tag = `${member.username}#${member.discriminator}`;

				if (tag === player.name) {
					reply("Dat ben jij zelf. Hulp is beschikbaar. 0800-0113");
					return;
				}

				const victim = game.players.find((p) => p.name === tag);
				if (!victim) {
					return "Die guy speelt niet eens eh";
				}

				// Now really attack
				const attackRes = game.doAttack(player.id, victim.id);

				if (attackRes !== "ok") {
					reply(attackRes);
					sendToDiscord(game);
					return;
				}

				reply("Zo doen wij dat bruur");
				sendToDiscord(game);

				break;
			}
			case "gift": {
				const apCount = Number(
					Number(
						interaction.data.options.find((v) => v.name === "ap_count").value
					) || 0
				);
				const receiverId = interaction.data.options.find(
					(v) => v.name === "receiver"
				).value;
				const member = await client.users.fetch(receiverId);
				const tag = `${member.username}#${member.discriminator}`;

				if (tag === player.name) {
					reply("Wrm wil je jezelf giften???");
					return;
				}

				const receiver = game.players.find((p) => p.name === tag);
				if (!receiver) {
					return "Die guy speelt niet eens eh";
				}

				// Now really attack
				const giftRes = game.doGift(player.id, receiver.id, apCount);

				if (giftRes !== "ok") {
					reply(giftRes);
					sendToDiscord(game);
					return;
				}

				reply("Dat is lief van je");
				sendToDiscord(game);

				break;
			}
			case "pos": {
				if (player.health <= 0) {
					reply(`Je positie? Broer je bent dood 😂`);
					return;
				}
				reply(`Your position: X ${player.coords.x}, Y ${player.coords.y}`);
				break;
			}
			case "range": {
				const rangeRes = game.doRangeIncrease(player.id);

				if (rangeRes !== "ok") {
					sendToDiscord(game);
					reply(rangeRes);
					return;
				}

				sendToDiscord(game);
				reply("Goed bezig broer");
				break;
			}
			default: {
				reply(`Da command ken ik niet man... ${slashCommandName}???`);
			}
		}
	});
});

async function installCommands() {
	for (let guild of Object.values(client.guilds.cache.toJSON())) {
		await getApp(guild.id).commands.post({
			data: {
				name: "board",
				description: "Get an up-to-date view of the board",
			},
		});

		await getApp(guild.id).commands.post({
			data: {
				name: "pos",
				description: "Get your in-game coordinates",
			},
		});

		await getApp(guild.id).commands.post({
			data: {
				name: "range",
				description: "Trade 2 AP for a range increase",
			},
		});

		await getApp(guild.id).commands.post({
			data: {
				name: "walk",
				description: "Use 1 AP to walk in any of 8 direction",
				options: [
					{
						name: "direction",
						description: "The driection you want to walk in",
						type: 3,
						required: true,
						choices: [
							{
								name: "Up",
								value: "up",
							},
							{
								name: "Upper left",
								value: "up_left",
							},
							{
								name: "Upper right",
								value: "up_right",
							},
							{
								name: "Left",
								value: "left",
							},
							{
								name: "Right",
								value: "right",
							},
							{
								name: "Down",
								value: "down",
							},
							{
								name: "Bottom right",
								value: "down_right",
							},
							{
								name: "Bottom left",
								value: "down_left",
							},
						],
					},
					{
						name: "step_count",
						description: "The amount of times to repeat this action",
						type: 4,
						required: false,
					},
				],
			},
		});

		await getApp(guild.id).commands.post({
			data: {
				name: "attack",
				description: "Attack someone, taking 1 HP if they are in range",
				options: [
					{
						name: "victim",
						description: "The person you want to kill",
						type: 6,
						required: true,
					},
				],
			},
		});

		await getApp(guild.id).commands.post({
			data: {
				name: "gift",
				description: "Gift someone in your range a set amount of AP",
				options: [
					{
						name: "receiver",
						description: "The person you want to gift AP",
						type: 6,
						required: true,
					},
					{
						name: "ap_count",
						description: "The amount of AP you want to donate",
						type: 4,
						required: true,
					},
				],
			},
		});
	}
}

client.on("message", async (msg) => {
	if (msg.author.bot) return;
	let m = msg.content;
	if (m.startsWith(`${prefix}create`)) {
		const members = msg.mentions.users.toJSON();

		// @ts-ignore
		const players: PlayerInfo[] = members.map((v) => {
			return {
				name: v.tag,
				icon: v.avatarURL.replace(/webp/g, "png"),
			};
		});

		if (players.length < 3) {
			msg.reply("Op zn minst 3 spelers eh a neef niffo makker maatje");
			return;
		}

		const game = new TankTacticsGame({
			playerInfo: players,
			name: `${client.user.username.replace(/[^a-zA-Z]/g, "").toLowerCase()}-${
				games.length + 1
			}`,
			guild: msg.guild.id,
		});

		games.push(game);

		db.set("games", games);

		doGameListeners();

		msg.reply("okie dokie");
		sendToDiscord(game);
	}

	if (m.startsWith(`${prefix}board`)) {
		// @ts-ignore
		const game = games.find((g) => g.name === msg.channel.name);
		if (game) {
			await msg.reply("Komt er aan broer");
			sendToDiscord(game);
		} else {
			await msg.reply("Wtf er is geen potje in deze channel a man");
		}
	}

	console.log(m);
	// console.log(games)
});

const gameToCanvas = async (game: TankTacticsGame) => {
	const canvas = createCanvas(game.boardWidth * 10, game.boardHeight * 10);
	const ctx = canvas.getContext("2d");

	ctx.fillStyle = "#36393E";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const cellWidth = Math.floor(canvas.width / game.boardWidth);
	const cellHeight = Math.floor(canvas.width / game.boardWidth);

	await Promise.all(
		game.players.map(async (v) => {
			if (!playerImages[v.name]) playerImages[v.name] = await loadImage(v.icon);
		})
	);

	for (let y = 0; y < game.boardHeight; y++) {
		for (let x = 0; x < game.boardWidth; x++) {
			const closestPlayers = game.getClosestPlayer(x, y);
			const closestPlayer = closestPlayers[0];

			ctx.fillStyle = "white";

			// if (closestPlayer.distance === 0) {
			// 	ctx.fillStyle = "transparent";
			// } else if (Math.floor(closestPlayer.distance) <= closestPlayer.range) {
			// 	ctx.fillStyle = "yellow";
			// }

			const colors = [
				"rgb(0, 122, 255)",
				"rgb(52, 199, 89)",
				"rgb(255, 149, 0)",
				"rgb(88, 86, 214)",
				"rgb(255, 45, 85)",
				"rgb(175, 82, 222)",
				"rgb(255, 59, 48)",
				"rgb(90, 200, 250)",
				"rgb(255, 204, 0)",
			];

			for (let player of closestPlayers) {
				if (Math.floor(player.distance) <= player.range) {
					ctx.fillStyle = colors[Number(player.id) % colors.length];
				}
			}

			ctx.globalAlpha = Math.max((15 - closestPlayer.distance2) / 15, 0);

			ctx.fillRect(
				x * cellWidth,
				y * cellHeight,
				cellWidth - 1,
				cellHeight - 1
			);

			if (closestPlayer.distance === 0) {
				ctx.drawImage(
					playerImages[closestPlayer.name],
					x * cellWidth,
					y * cellHeight,
					cellWidth - 1,
					cellHeight - 1
				);
			}
		}
	}

	return canvas;
};

async function getAllChannels() {
	await Promise.all(
		Object.values(client.guilds.cache.toJSON()).map(async (g) => {
			await client.guilds.fetch(g.id);
		})
	);

	// @ts-ignore
	const channels = [...Object.values(client.channels.cache.toJSON())];
	return channels;
}

async function sendToDiscord(game: TankTacticsGame) {
	console.time("canvas-make");
	const gameCanvas = await gameToCanvas(game);
	console.timeEnd("canvas-make");

	console.time("find-channel");

	const channels = await getAllChannels();
	let gameChannel = channels.find((c) => c.name === game.name);
	if (!gameChannel) {
		let g = await client.guilds.fetch(game.guild);
		gameChannel = await g.channels.create(game.name);
	}
	let channel = client.channels.cache.get(gameChannel.id);
	console.timeEnd("find-channel");

	console.time("parse-image");
	// Convert to image and send it
	const url = gameCanvas.toDataURL();
	const sfbuff = Buffer.from(url.split(",")[1], "base64");
	const sfattach = new Discord.MessageAttachment(sfbuff, "output.png");
	console.timeEnd("parse-image");

	let longestName = "";
	for (let player of game.players) {
		if (player.name.length > longestName.length) {
			longestName = player.name;
		}
	}

	console.time("send-image");
	// @ts-ignore
	await channel.send(
		`
	\`\`\`${game.players
		.sort((a, b) => b.points - a.points)
		.sort((a, b) => b.health - a.health)
		.map((p) => {
			return `${p.name.padEnd(
				longestName.length + 2,
				" "
			)} ${`${p.points} AP`.padEnd(5, " ")} ${`${p.health} lives`.padEnd(
				10,
				" "
			)} ${p.range} range`.trim();
		})
		.join("\n")}\`\`\``,
		{
			files: [sfattach],
		}
	);
	console.timeEnd("send-image");
}

setInterval(() => {
	console.log("Forcefully storing db");
	db.store(false);
}, 60e3 * 2);

client.login(process.env.token);

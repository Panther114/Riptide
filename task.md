\# Build a Complete 2D WWII Naval Combat Prototype



Create a genuinely playable, polished prototype of a \*\*2D World War II naval combat simulator\*\*. Take substantial creative ownership of the project: research relevant historical references, naval combat behavior, ship layouts, visual references, and comparable games online where useful. Make bold design decisions independently rather than constantly asking for clarification.



The goal is not merely to demonstrate mechanics. Produce something that feels like a coherent, high-quality indie game prototype with a complete playable loop.



\## Core Concept



The game is a strictly \*\*2D top-down naval combat simulator\*\* combining accessible arcade controls with meaningful semi-realistic simulation.



Ships should behave as physical fighting vessels rather than simple health bars. Each ship contains functional internal modules, armor, weapons, propulsion, steering, flooding, ammunition, and other systems. Shell impacts should interact meaningfully with armor and internal components.



The simulation should be believable and internally consistent without sacrificing playability.



\## Initial Prototype



For this first version, create a simple \*\*1v1 battle\*\*:



\- One blue battleship controlled by the player.

\- One red battleship controlled by AI.

\- The battle ends when one side has effectively lost its ability to fight, usually through sinking or catastrophic combat damage.



Do \*\*not\*\* build full multiplayer yet. However, organize the game around the eventual concept of multiple independently controlled ships so that multiplayer and larger battles can be added later without fundamentally redesigning the game.



Ultimately, the intended format is battles containing several ships per team, with humans occupying selected ships and AI controlling the remainder.



\## Ship



For now, implement \*\*one battleship type\*\*.



Prefer a real historical WWII battleship if sufficiently accurate visual and structural references can be obtained and adapted into the game. Otherwise, create a fictional battleship that is clearly grounded in historically plausible WWII naval engineering.



The ship should look convincing both externally and internally.



Its internal 2D layout is not decorative UI. It represents the actual functional structure of the vessel.



Important systems should include, at minimum:



\- Main guns and ammunition

\- Armor

\- Engines and propulsion

\- Steering

\- Internal compartments/modules

\- Flooding and sinking

\- Fires

\- Ammunition detonations

\- Destruction or disabling of major systems



Do not implement crew simulation, active module repair, or secondary weapons for this prototype.



Choose an appropriate level of additional simulation depth yourself.



A destroyed engine should meaningfully affect movement. Destroyed weapons should stop functioning. Flooding should threaten buoyancy. Severe internal damage should be capable of rendering the ship combat-ineffective even before it completely sinks.



\## Armor and Damage



Create a convincing shell-impact and penetration system.



A shell striking a ship should consider factors such as the armor it encounters, the circumstances of the impact, penetration, and what lies behind the armor. Penetrating hits should damage relevant internal components rather than simply subtracting arbitrary global health.



Aim for \*\*semi-realistic naval combat\*\*, not exhaustive engineering simulation.



The player should be able to understand, through gameplay and visual feedback, why particular hits caused particular consequences.



\## Ship Control



Use the mouse for aiming.



Use:



\- \*\*W / S\*\* for forward/reverse propulsion control.

\- \*\*A / D\*\* to steer the rudder left or right.

\- \*\*Left mouse button\*\* to fire the main guns.

\- \*\*Mouse wheel\*\* to zoom the camera.

\- \*\*Middle mouse button\*\* for camera target locking.



Provide polished visual indicators showing the ship's current heading and steering direction. When the rudder is being held left or right, the directional indicator should communicate the intended turn naturally and elegantly.



\## Gunnery



The mouse cursor represents where the player wants the guns to aim.



The actual guns must physically take time to rotate toward that bearing, so distinguish clearly between:



1\. The player's requested aim point.

2\. Where the guns are currently capable of firing.



Use a custom aiming cursor.



Also visualize shell dispersion around the intended impact point.



Show approximately:



\- An outer region containing roughly \*\*90%\*\* of expected shell impacts.

\- A smaller region representing roughly \*\*50%\*\* of expected shell impacts.



These regions should update dynamically based on the firing situation and should feel visually integrated into the game rather than like debug overlays.



Shell dispersion should matter, but the guns should remain accurate enough for combat to feel deliberate and enjoyable.



\## Camera



The player should be able to zoom from a close tactical view to a very distant view showing most or all of the battlefield.



Show useful weapon-range information when appropriate.



Normally, the camera follows the player's ship.



Middle-clicking an enemy ship should smoothly shift the camera's focus toward that ship. This target lock is primarily a camera and observation feature rather than an automatic combat mechanic.



Middle-clicking empty space should return focus to the player's own ship.



All camera movement, zooming, transitions, and feedback should feel exceptionally smooth.



\## AI



The enemy ship should be controlled by competent AI capable of fighting in a believable naval manner.



The long-term game is intended to contain several AI-controlled ships that can coordinate with one another, so design the AI concept with that eventual expansion in mind.



Research historical naval tactics where useful, but prioritize believable and enjoyable behavior over rigid historical reenactment.



The AI should not feel omniscient or mechanically perfect.



\## Future Lobby Concept



Although the first playable version is only a 1v1 battle, preserve the broader game concept.



Eventually, a lobby owner should be able to:



\- View the battlefield/map.

\- Choose how many ships participate.

\- Place ships freely.

\- Assign ships to red or blue teams.

\- Choose ship types.

\- Allow players to select which ships they control.

\- Give remaining ships to AI.



You do not need to build the complete multiplayer experience in this prototype, but avoid design choices that would make this concept difficult to implement later.



\## Visual Direction



The visual target is:



\*\*Realistic WWII tactical naval combat + clean, high-end indie-game stylization.\*\*



Keep the simulation strictly 2D.



Ships, water, projectiles, explosions, fires, shadows, damage effects, wakes, impacts, camera motion, and UI feedback should collectively make the game feel polished and atmospheric without sacrificing visual clarity.



Avoid generic placeholder aesthetics wherever practical.



Research references and use your own judgment to establish a coherent visual identity.



\## Interface



The combat interface should be minimal, clear, and professional.



Use games such as \*\*War Thunder naval combat\*\* as inspiration for information hierarchy, particularly the idea of showing a ship's internal condition visually, but do not simply copy its interface.



Include a bottom-left ship status visualization showing the vessel and its internal modules. Module condition should be immediately understandable through visual states—for example, healthy, damaged, severely damaged, or completely disabled.



Design the rest of the interface yourself.



The final game should feel like its own product rather than a reproduction of another game's UI.



\## Design Philosophy



Treat everything above as the \*\*core intent rather than an exhaustive specification\*\*.



You have broad autonomy over:



\- Exact balancing

\- Visual composition

\- UI layout

\- Animation

\- AI behavior

\- Effects

\- Simulation depth

\- Secondary mechanics

\- Presentation

\- Historical interpretation

\- Small changes necessary to make the game coherent



When something is underspecified, investigate the problem, inspect appropriate references, make a strong design decision, and continue.



Do not overcomplicate systems merely for realism. Conversely, do not simplify the core naval simulation into ordinary arcade hit points.



Prioritize, in roughly this order:



1\. A complete playable game loop.

2\. Satisfying naval combat.

3\. Functional modular ship damage.

4\. Clear and responsive controls.

5\. Strong visual polish and animation.

6\. Believable AI.

7\. Historical plausibility.

8\. A foundation that can later support larger battles and multiplayer.



Work autonomously. Test the game thoroughly, identify weak areas yourself, iterate on them, and deliver the most polished complete prototype you can.

Try to work completely in the background. That is, you can take screenshots in the background, but do not take any action that would hijack my desktop. Feel free to use anything from the internet, and download public resources.


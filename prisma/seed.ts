import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const adminPassword = await hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'lucas.terpreau3@gmail.com' },
    update: {},
    create: {
      email: 'lucas.terpreau3@gmail.com',
      name: 'MLF Jobs',
      passwordHash: adminPassword,
      role: 'admin',
      subscriptionStatus: 'active',
    },
  });
  console.log(`Admin user created: ${admin.email}`);

  // Create demo subscriber
  const demoPassword = await hash('demo123', 12);
  const demo = await prisma.user.upsert({
    where: { email: 'demo@jobclub.com.au' },
    update: {},
    create: {
      email: 'demo@jobclub.com.au',
      name: 'Marie Dupont',
      passwordHash: demoPassword,
      role: 'user',
      subscriptionStatus: 'active',
    },
  });
  console.log(`Demo user created: ${demo.email}`);

  // Real-style jobs matching actual Podia posts
  const jobs = [
    {
      title: 'WE\'RE HIRING – WAREHOUSE POSITION',
      company: 'Mount Isa Pets & Produce',
      state: 'QLD',
      location: 'Mount Isa, QLD',
      category: 'other',
      type: 'full_time',
      pay: '$27-30/h',
      description: `Join the team at Mount Isa Pets & Produce, the largest supplier of pet & produce needs in the North West.

We're looking for a reliable, physically fit warehouse team member to join our hardworking crew.

About the Role:
This is a full-time warehouse position working in a busy environment.

Duties include:
• Loading & unloading stock
• Handling feed, produce & general warehouse goods
• Assisting customers when required
• Maintaining a clean & organised workspace
• General day to day warehouse duties

What We're Looking For:
• Strong & physically fit
• Driver's Licence (essential)
• Forklift Licence (or willingness to obtain)
• Reliable, punctual & hardworking
• Able to work both independently & as part of a team

Why Join Us?
• Work with a wide range of pet supplies, feed & rural products
• Full-time position

How to Apply:
Send your resume to manager@mountisapetsandproduce.com.au
OR apply in store

For more information, contact Joyce or William on: (07) 4743 2265`,
      applyUrl: 'mailto:manager@mountisapetsandproduce.com.au',
    },
    {
      title: 'Experienced cook for weekend work',
      company: 'Stony Creek Brewing',
      state: 'QLD',
      location: 'Queensland',
      category: 'hospitality',
      type: 'casual',
      pay: '$28-32/h',
      description: `Needing a cook for a busy burger bar in a brewery. We do smash burgers, pizzas and snacks, nothing fancy. Mainly Friday and Saturday night work with one weekday shift. We've got a pretty small kitchen and do a lot of prep, high volume so some experience on grill and fryers is preferred. 5-15 hours a week to start.

Text me on 0499566847 or email kitchen@stonycreekbrewing.com.au`,
      applyUrl: 'mailto:kitchen@stonycreekbrewing.com.au',
    },
    {
      title: 'Casual Team Member',
      company: 'FNQ BBQ & Outdoors',
      state: 'QLD',
      location: 'Cairns, QLD',
      category: 'other',
      type: 'casual',
      pay: '$25-28/h',
      description: `We are looking for a casual team member (with a view to a permanent position) who is enthusiastic and willing to learn. This role includes dealing with stock - often large BBQs - so an ability to lift heavy objects is essential.

You can email your CV to us at sales@fnqbbq.com.au - however we prefer if you drop your CV in to us personally.

Immediate start.`,
      applyUrl: 'mailto:sales@fnqbbq.com.au',
    },
    {
      title: 'Housekeeper',
      company: 'Sanctuary Palm Cove',
      state: 'QLD',
      location: 'Palm Cove, QLD',
      category: 'hospitality',
      type: 'casual',
      pay: '$26/h',
      description: `Hi All

Sanctuary Palm Cove

We are currently hiring a Housekeeper

Hours are 10am till 2pm

Preferably someone with previous housekeeper experience and lives in the Beaches.

Position will be on a casual basis and could be ongoing as we start to enter our busy season.

You can contact us via email info@sanctuarypalmcove.com.au or pop into our reception.`,
      applyUrl: 'mailto:info@sanctuarypalmcove.com.au',
    },
    {
      title: 'Line Crew Labourers - QLD',
      company: 'Powerline Services QLD',
      state: 'QLD',
      location: 'Across Queensland',
      category: 'construction',
      type: 'full_time',
      pay: '$35-42/h',
      description: `The Role

Join a dynamic and hardworking team supporting Line Crew Labourers across Queensland. This entry-level, labour-intensive role involves working outdoors in remote areas, contributing to essential fieldwork that requires accuracy, physical fitness, and a safety-first mindset. You'll be part of a team that values communication, teamwork, and adaptability in constantly changing field environments.

Key Responsibilities:
• Assist with the installation and maintenance of power lines
• Carry out manual tasks including digging, lifting and equipment transport
• Follow safety procedures at all times
• Work as part of a team in remote and regional areas

Requirements:
• Construction White Card
• Valid driver's licence
• Physically fit and able to work outdoors in all conditions
• Willing to travel and work away from home
• Reliable and safety-conscious

This role counts towards your 88 regional days for WHV holders.`,
      applyUrl: 'https://seek.com.au/job/example-line-crew',
    },
    {
      title: 'BAR & KITCHEN STAFF REQUIRED',
      company: 'Bororen Hotel',
      state: 'QLD',
      location: 'Bororen, QLD',
      category: 'hospitality',
      type: 'part_time',
      pay: '$27-30/h',
      description: `BOROREN HOTEL ARE LOOKING FOR EXPERIENCED BAR STAFF, AND MAY BE NEEDED IN THE KITCHEN SOMETIMES. YOU MUST HAVE EXPERIENCE IN PUBS, RSA RSG AND WOULD PREFER YOU TO HAVE RMLV AS WELL, ALSO A FOOD HANDLING COURSE. GREAT BALANCED PACKAGES FOR THE RIGHT PERSON OR PEOPLE, ALSO COULD LOOK AT PART TIME POSITION AS WELL FOR THE RIGHT PERSON. MUST BE FLEXIBLE.

BOROREN IS ONLY 25 MINS FROM BENARARY AND TANNUM SANDS

APPLY BY E/MAIL ONLY PLEASE at bororenhotelmotel@gmail.com`,
      applyUrl: 'mailto:bororenhotelmotel@gmail.com',
    },
    {
      title: 'Strawberry Runner - Armidale NSW and Ballandean QLD',
      company: 'Granite Belt Strawberries',
      state: 'QLD',
      location: 'Ballandean, QLD',
      category: 'farm',
      type: 'casual',
      pay: 'Piece rate',
      description: `We are currently looking for strawberry runners for our farms in both Armidale NSW and Ballandean QLD.

The Role:
• Planting and maintaining strawberry crops
• Picking and packing strawberries
• General farm maintenance duties

What we offer:
• Accommodation available on farm ($130/week)
• Transport to and from the fields
• Days count towards your 88 days for WHV
• Good piece rates — experienced pickers earn $200-300/day

No experience necessary — training provided on arrival.

Start date: Immediate

Contact us at info@granitebeltberries.com.au to apply.`,
      applyUrl: 'mailto:info@granitebeltberries.com.au',
    },
    {
      title: 'Staff Wanted - Work For Accommodation',
      company: 'Jackaroo Treehouse Rainforest Retreat',
      state: 'QLD',
      location: 'Mission Beach, QLD',
      category: 'hospitality',
      type: 'casual',
      pay: 'Work for accommodation',
      description: `Want to work on your tan and live in a rainforest with the Great Barrier Reef at your doorstep?

We've got just the thing for you.

The Jackaroo Treehouse Rainforest Retreat is located in the rainforests of Mission Beach and we are looking for friendly staff who would like to work a couple of hours a day housekeeping in exchange for accommodation.

We will provide you with:
• Shared Dorm Room Accommodation
• Laundry Facilities
• Unlimited Wifi
• Pool and common areas access
• Local tips and tour discounts

In return we ask for approximately 2-3 hours of housekeeping work per day, 5 days a week.

This is a great opportunity to live in one of Australia's most beautiful tropical locations while saving money on rent.

Email us at stay@jackarootreehouse.com.au with a bit about yourself.`,
      applyUrl: 'mailto:stay@jackarootreehouse.com.au',
    },
    {
      title: 'WE\'RE HIRING – PALMWOODS HOTEL',
      company: 'Palmwoods Hotel',
      state: 'QLD',
      location: 'Palmwoods, Sunshine Coast, QLD',
      category: 'hospitality',
      type: 'casual',
      pay: '$27-32/h',
      description: `We're on the lookout for new team members to join the Palmwoods Hotel crew!

We have opportunities across:
• Management
• Bar Staff
• Kitchen Staff
• Gaming Attendants
• Bottle Shop Staff

What we're looking for:
• RSA (required for bar & bottle shop roles)
• Positive attitude and strong work ethic
• Ability to work weekends and public holidays
• Previous hospitality experience preferred but not essential

Located on the beautiful Sunshine Coast hinterland, we're a friendly community pub with a great team culture.

Send your CV to admin@palmwoodshotel.com.au or drop it in to us!`,
      applyUrl: 'mailto:admin@palmwoodshotel.com.au',
    },
    {
      title: 'Dishwasher / Kitchen Hand',
      company: 'Lake Barrine Teahouse',
      state: 'QLD',
      location: 'Lake Barrine, Atherton Tablelands, QLD',
      category: 'hospitality',
      type: 'casual',
      pay: '$25-27/h',
      description: `We're hiring!

Looking for a motivated, proactive and energetic dishwasher to join our team at Lake Barrine Teahouse.

This role involves standing for long periods, lifting, and working in a fast-paced environment.

Work surrounded by rainforest, great people, and a fast-paced environment.

Details:
• You'll need your own car (we're 1 hour from Cairns)
• Yungaburra is just 9 minutes away
• Accommodation may be available

Send your CV to teahouse@lakebarrine.com.au`,
      applyUrl: 'mailto:teahouse@lakebarrine.com.au',
    },
    {
      title: 'Farm Hand - Cattle Station',
      company: 'Dotswood Station',
      state: 'QLD',
      location: 'Charters Towers, QLD',
      category: 'farm',
      type: 'full_time',
      pay: '$800-1000/week + accommodation',
      description: `Dotswood Station is looking for a reliable farm hand to assist with cattle work on our property near Charters Towers.

Duties include:
• Mustering and moving cattle
• Fencing repairs and maintenance
• General station upkeep
• Feeding and water management
• Vehicle and machinery maintenance

Requirements:
• Must be physically fit
• Driver's licence essential
• Horse riding experience a plus but not essential
• Happy to live in a remote area
• Minimum 3 month commitment

We provide:
• Accommodation and meals
• Great station life experience
• Counts towards your 88 WHV days

Email your resume to admin@dotswoodstation.com.au`,
      applyUrl: 'mailto:admin@dotswoodstation.com.au',
    },
    {
      title: 'Wait Staff & Barista',
      company: 'The Grounds Cafe',
      state: 'NSW',
      location: 'Alexandria, Sydney, NSW',
      category: 'hospitality',
      type: 'part_time',
      pay: '$28-32/h + tips',
      description: `We're looking for enthusiastic wait staff and baristas to join our busy cafe in Alexandria.

What we need:
• Previous cafe/restaurant experience
• RSA certificate
• Barista skills preferred for coffee roles
• Available weekends and public holidays
• Friendly personality and strong customer service

We offer:
• Competitive hourly rates
• Meal on shift
• Fun, supportive team environment
• Inner city location close to public transport

Send your CV and availability to jobs@thegroundscafe.com.au`,
      applyUrl: 'mailto:jobs@thegroundscafe.com.au',
    },
    {
      title: 'Removalist / Furniture Mover',
      company: 'Sydney Fast Removals',
      state: 'NSW',
      location: 'Sydney Metro, NSW',
      category: 'other',
      type: 'casual',
      pay: '$28-35/h',
      description: `We need strong, reliable people to help with furniture removals across the Sydney metro area.

The role:
• Packing, loading, and unloading household furniture
• Driving removal trucks (if licensed)
• Protecting items during transport
• Working in a team of 2-3 people

Requirements:
• Physically fit — this is heavy manual work
• Reliable and punctual
• Driver's licence preferred (can earn more with MR licence)
• Available for early starts
• ABN required (or we can help you set one up)

This is casual work — we'll offer you shifts as they come in, usually 3-5 days per week. Great for backpackers wanting flexible, well-paid work.

Text or call Mark on 0412 555 678 or email mark@sydneyfastremovals.com.au`,
      applyUrl: 'mailto:mark@sydneyfastremovals.com.au',
    },
    {
      title: 'Blueberry Picker - Coffs Harbour',
      company: 'OzBerries Farm',
      state: 'NSW',
      location: 'Coffs Harbour, NSW',
      category: 'farm',
      type: 'casual',
      pay: 'Piece rate ($4-8/kg)',
      description: `Blueberry season is coming up! We need pickers for our farm just outside Coffs Harbour.

Season: April to August
Hours: 6am - 2pm (weather dependent)

What we offer:
• Piece rate — good pickers earn $200-350/day
• Hostel accommodation nearby at $140/week
• Shuttle from hostel to farm
• All days count towards your 88 WHV days

No experience needed — we train you on day one.

To apply, email your name, visa details and available start date to: hiring@ozberries.com.au`,
      applyUrl: 'mailto:hiring@ozberries.com.au',
    },
    {
      title: 'Construction Labourer - CBD Sites',
      company: 'ProBuild Construction',
      state: 'VIC',
      location: 'Melbourne CBD, VIC',
      category: 'construction',
      type: 'full_time',
      pay: '$35-42/h',
      description: `ProBuild Construction is looking for general labourers for our CBD high-rise projects.

Duties:
• Site clean-up and waste management
• Material handling and distribution
• Assisting tradespeople as required
• Operating small machinery and power tools

Requirements:
• White Card (mandatory)
• Steel cap boots and hi-vis
• Physically fit
• Reliable — we need people who show up every day
• Monday to Friday, 7am-3:30pm

We pay weekly and rates go up after your first month. Overtime available on Saturdays.

Apply via email: hr@probuild.com.au with your White Card number and a brief intro.`,
      applyUrl: 'mailto:hr@probuild.com.au',
    },
    {
      title: 'Hotel Reception - Night Shift',
      company: 'Mantra South Bank',
      state: 'VIC',
      location: 'South Bank, Melbourne, VIC',
      category: 'hospitality',
      type: 'part_time',
      pay: '$30-35/h (night rates)',
      description: `We have a part-time night reception position available at Mantra South Bank.

Shifts: 11pm - 7am, 3-4 nights per week (including weekends)

The role:
• Check-in/check-out of guests
• Handling phone and email enquiries
• Managing reservations
• Basic concierge duties
• Light admin tasks during quiet periods

Requirements:
• Previous hotel or customer service experience
• Professional presentation
• Comfortable working alone overnight
• Good spoken English

Night rates are excellent and the role is perfect if you're studying during the day.

Apply at careers@mantrasouthbank.com.au`,
      applyUrl: 'mailto:careers@mantrasouthbank.com.au',
    },
    {
      title: 'Painter - Residential & Commercial',
      company: 'Oz Painters',
      state: 'SA',
      location: 'Adelaide, SA',
      category: 'trade',
      type: 'full_time',
      pay: '$32-40/h',
      description: `We're a busy Adelaide painting company looking for painters to join our team.

We do a mix of residential and commercial work across the Adelaide metro area.

What we need:
• Some painting experience preferred but will train the right person
• Own reliable transport to get to job sites
• White Card (or willingness to get one)
• Physically fit and not afraid of heights
• Team player with a good attitude

What we offer:
• Consistent full-time work year-round
• All tools and equipment provided
• Vehicle for site-to-site travel during the day
• Overtime available
• Supportive team — we have several French speakers on the crew

Start: Immediate

Email your details to jobs@ozpainters.com.au or call Dave on 0433 888 912`,
      applyUrl: 'mailto:jobs@ozpainters.com.au',
    },
    {
      title: 'Oyster Farm Worker',
      company: 'Coffin Bay Oysters',
      state: 'SA',
      location: 'Coffin Bay, SA',
      category: 'farm',
      type: 'casual',
      pay: '$28/h',
      description: `Work on one of Australia's most famous oyster farms in beautiful Coffin Bay on the Eyre Peninsula.

The role:
• Sorting, grading and packing oysters
• Working on the water in oyster leases
• Equipment cleaning and maintenance
• Early morning starts (5am-1pm most days)

Requirements:
• Physically fit — you'll be on your feet in all weather
• Happy to get wet and muddy!
• No experience needed — full training provided
• Must be available for at least 3 months

We provide:
• All wet weather gear and equipment
• Help finding accommodation in town
• Days count towards 88 WHV days
• A truly unique Australian experience

Apply to: farmjobs@coffinbayoysters.com.au`,
      applyUrl: 'mailto:farmjobs@coffinbayoysters.com.au',
    },
    {
      title: 'Cleaner - Offices & Commercial',
      company: 'SparkClean Services',
      state: 'ACT',
      location: 'Canberra, ACT',
      category: 'other',
      type: 'part_time',
      pay: '$27-30/h',
      description: `SparkClean is hiring cleaners for office and commercial buildings across Canberra.

Available shifts:
• Early morning: 5am - 9am
• Evening: 6pm - 10pm

Perfect as a second job or alongside studies.

Duties:
• Vacuuming, mopping, dusting
• Bathroom cleaning and restocking
• Kitchen area cleaning
• Emptying bins and general tidying

Requirements:
• Reliable and detail-oriented
• ABN required (we can help you set one up)
• Police check (we'll organise this for you)
• Own transport preferred

We provide all cleaning supplies and equipment.

Apply at hello@sparkclean.com.au with your availability.`,
      applyUrl: 'mailto:hello@sparkclean.com.au',
    },
    {
      title: 'Electrician - Residential New Builds',
      company: 'Spark Solutions WA',
      state: 'WA',
      location: 'Perth Metro, WA',
      category: 'trade',
      type: 'full_time',
      pay: '$42-55/h',
      description: `Busy electrical company in Perth is looking for qualified electricians to work on residential new builds.

The role:
• First and second fix electrical work
• Solar panel installations
• Switchboard upgrades
• Reading and interpreting electrical plans

Requirements:
• Australian electrical licence (or recognised equivalent)
• WA Restricted or Unrestricted licence preferred
• Own hand tools
• Driver's licence
• ABN (subcontract basis)

What we offer:
• Consistent work — we have projects booked months ahead
• Company vehicle negotiable for the right candidate
• Visa sponsorship may be available after 6 months for qualified candidates

Contact: recruitment@sparksolutionswa.com.au`,
      applyUrl: 'mailto:recruitment@sparksolutionswa.com.au',
    },
    {
      title: 'Banana Packing Shed Workers',
      company: 'North QLD Banana Co',
      state: 'QLD',
      location: 'Tully, QLD',
      category: 'farm',
      type: 'casual',
      pay: '$25-28/h',
      description: `We're looking for workers for our banana packing shed in Tully, North QLD.

The work:
• Sorting and grading bananas on the packing line
• Packing bananas into boxes
• Quality control
• Shed cleaning at end of shift

This is shed work (not field picking) so it's less physically demanding and you're under cover.

Hours: Usually 6am-2pm, Monday to Saturday (Sunday off)

What we provide:
• Hostel accommodation at $140/week
• Daily shuttle from hostel to the shed
• All PPE provided
• Days count towards your 88 WHV days

Start: Immediate — we have positions available now.

Email: jobs@nqbanana.com.au with your name, visa type, and available start date.`,
      applyUrl: 'mailto:jobs@nqbanana.com.au',
    },
    {
      title: 'Receptionist / Admin - Backpackers Hostel',
      company: 'Nomads Noosa',
      state: 'QLD',
      location: 'Noosa, Sunshine Coast, QLD',
      category: 'hospitality',
      type: 'full_time',
      pay: '$26/h + free accommodation',
      description: `Nomads Noosa is looking for a friendly, organised receptionist to join our team.

The role:
• Checking guests in and out
• Answering phone and email enquiries
• Managing bookings (we use Cloudbeds)
• Helping guests with local info, tours, and transport
• Light admin duties

What we offer:
• Free accommodation in our staff room
• Competitive hourly rate
• Discounted tours and activities
• Fun, social work environment
• Located in beautiful Noosa — surf and sunshine every day!

Requirements:
• Conversational English (you'll be dealing with guests from all over)
• Customer service experience
• Comfortable with computers and booking systems
• Available for rotating shifts including weekends

This is a great role if you want to save money (free rent!) while living in one of Australia's best beach towns.

Apply to: manager@nomadsnoosa.com.au`,
      applyUrl: 'mailto:manager@nomadsnoosa.com.au',
    },
    {
      title: 'Cherry Picker - Young NSW',
      company: 'Hilltop Cherries',
      state: 'NSW',
      location: 'Young, NSW',
      category: 'farm',
      type: 'casual',
      pay: 'Piece rate ($3-5/kg)',
      description: `Cherry season is almost here!

We need cherry pickers for our orchards in Young, NSW.

Season: November to January
Hours: 5am start — finish when it gets too hot (usually 1-2pm)

Pay:
• Piece rate — you earn per kg picked
• Good pickers consistently earn $200-350 per day
• We'll train you in the first week so you can get up to speed

What we provide:
• Free camping on the farm (BYO tent or swag)
• Hot showers and toilet facilities
• Small shop on site for basics
• Friendly team of backpackers from all over

All days worked count towards your 88 regional days for WHV.

To secure your spot, email: picking@hilltopcheries.com.au with your name, visa details, and available dates.`,
      applyUrl: 'mailto:picking@hilltopcheries.com.au',
    },
    {
      title: 'Sous Chef - Busy Restaurant',
      company: 'Hobart Waterfront Kitchen',
      state: 'TAS',
      location: 'Hobart, TAS',
      category: 'hospitality',
      type: 'full_time',
      pay: '$65,000-75,000/year',
      description: `Hobart Waterfront Kitchen is looking for an experienced Sous Chef to join our team.

We're a busy waterfront restaurant serving modern Australian cuisine using the best Tasmanian produce.

The role:
• Assisting the Head Chef in daily kitchen operations
• Menu development and specials
• Staff training and supervision
• Stock management and ordering
• Maintaining food safety standards

Requirements:
• Minimum 2 years experience in a similar role
• Strong knowledge of Australian produce
• Food Safety Supervisor certificate
• Ability to work under pressure during busy service
• Leadership skills and a calm kitchen presence

We offer:
• Competitive salary
• Beautiful waterfront location
• Two consecutive days off per week
• Staff meals during service
• Opportunity to develop your career with an expanding restaurant group

Apply with your CV and a brief cover letter to: chef@hobartwaterfrontkitchen.com.au`,
      applyUrl: 'mailto:chef@hobartwaterfrontkitchen.com.au',
    },
    {
      title: 'Crocodile Farm Guide',
      company: 'Crocosaurus Cove',
      state: 'NT',
      location: 'Darwin, NT',
      category: 'other',
      type: 'casual',
      pay: '$27/h',
      description: `Ever wanted to work with crocodiles?

Crocosaurus Cove in the heart of Darwin CBD is hiring guides and animal handlers.

The role:
• Guiding visitors through the park
• Assisting with animal feeding and handling demonstrations
• Front desk and retail duties
• Keeping exhibits and public areas clean and safe

Requirements:
• Outgoing personality — you'll be presenting to groups
• Comfortable around animals (training provided for croc handling!)
• Good spoken English
• Available for rotating roster including weekends and public holidays
• First Aid certificate (or willing to obtain)

This is genuinely one of the most unique jobs you'll ever have. Come work in the only place in Australia where you can swim with saltwater crocs!

Email: jobs@crocosauruscove.com with a bit about yourself and your availability.`,
      applyUrl: 'mailto:jobs@crocosauruscove.com',
    },
    {
      title: 'Mechanic - 4WD Specialist',
      company: 'Outback Auto Repairs',
      state: 'NT',
      location: 'Alice Springs, NT',
      category: 'trade',
      type: 'full_time',
      pay: '$38-48/h',
      description: `Outback Auto Repairs in Alice Springs is looking for a qualified mechanic, ideally with 4WD experience.

We service everything from tourist campervans to local station vehicles and everything in between.

The role:
• General servicing and repairs
• 4WD suspension and drivetrain work
• Air conditioning servicing (huge demand here!)
• Roadside assistance callouts (occasional)

Requirements:
• Qualified mechanic (Certificate III or equivalent)
• Experience with 4WD vehicles preferred
• Own basic hand tools
• Driver's licence
• Able to work in hot conditions (it's Alice Springs!)

What we offer:
• Competitive pay above award rate
• All specialty tools provided
• Relaxed, friendly workshop atmosphere
• Sponsorship possible for the right candidate after 6 months
• Accommodation assistance for the first month

Contact: dave@outbackautorepairs.com.au or call (08) 8952 4567`,
      applyUrl: 'mailto:dave@outbackautorepairs.com.au',
    },
    {
      title: 'Au Pair - Perth Family',
      company: 'The Robertson Family',
      state: 'WA',
      location: 'Cottesloe, Perth, WA',
      category: 'other',
      type: 'full_time',
      pay: '$350/week + room & board',
      description: `We're a friendly Australian family in Cottesloe (beachside Perth) looking for an au pair to help with our two kids — Lily (5) and Max (8).

What we need:
• School drop-off and pick-up (8:30am and 3pm)
• After school care — homework help, snacks, park time
• Light meal prep for the kids
• Some light housekeeping (kids' rooms, laundry)
• Occasional weekend babysitting

Hours: Approx 25 hours/week, weekends mostly free

What we provide:
• Private bedroom with ensuite bathroom
• All meals included
• Use of the family car
• Close to Cottesloe Beach — 5 minute walk!
• $350/week pocket money

We're looking for someone who genuinely enjoys being around kids, is responsible, and wants to be part of our family for at least 3-6 months.

Experience with children preferred. First Aid certificate is a plus.

Email us at sarah.robertson@gmail.com with a bit about yourself and any childcare experience.`,
      applyUrl: 'mailto:sarah.robertson@gmail.com',
    },
  ];

  for (const job of jobs) {
    await prisma.job.create({ data: job });
  }
  console.log(`${jobs.length} jobs created`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

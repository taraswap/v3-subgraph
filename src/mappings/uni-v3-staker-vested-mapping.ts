import { ethereum, crypto, BigInt, Address } from '@graphprotocol/graph-ts'

import {
  DepositTransferred,
  IncentiveCreated,
  IncentiveEnded,
  RewardClaimed,
  TokenStaked,
  TokenUnstaked
} from '../types/UniV3StakerVested/UniV3StakerVested'
import {
  Claim,
  ERC20Token,
  Incentive,
  IncentivePosition,
  Pool,
  Position,
  Stake,
  Unstake,
  YieldFarmer
} from '../types/schema'
import { ERC20 } from '../types/Factory/ERC20'
import { getPosition } from './position-manager'
import { ADDRESS_ZERO } from '../utils/constants'

export function handleIncentiveCreated(event: IncentiveCreated): void {
  const incentiveIdTuple: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(event.params.rewardToken),
    ethereum.Value.fromAddress(event.params.pool),
    ethereum.Value.fromUnsignedBigInt(event.params.startTime),
    ethereum.Value.fromUnsignedBigInt(event.params.endTime),
    ethereum.Value.fromUnsignedBigInt(event.params.vestingPeriod),
    ethereum.Value.fromAddress(event.params.refundee)
  ]
  const incentiveIdEncoded = ethereum.encode(ethereum.Value.fromTuple(changetype<ethereum.Tuple>(incentiveIdTuple)))!
  const incentiveId = crypto.keccak256(incentiveIdEncoded)

  let entity = Incentive.load(incentiveId.toHex())
  if (entity == null) {
    entity = new Incentive(incentiveId.toHex())
  }

  let rewardToken = ERC20Token.load(event.params.rewardToken.toHex())
  if (!rewardToken) {
    rewardToken = new ERC20Token(event.params.rewardToken.toHex())
    const binding = ERC20.bind(event.params.rewardToken)
    rewardToken.name = binding.name()
    rewardToken.symbol = binding.symbol()
    rewardToken.decimals = binding.decimals()
    rewardToken.save()
  }

  const pool = Pool.load(event.params.pool.toHex())
  if (!pool) {
    return
  }

  entity.contract = event.address
  entity.rewardToken = rewardToken.id
  entity.pool = pool.id
  entity.startTime = event.params.startTime
  entity.endTime = event.params.endTime
  entity.refundee = event.params.refundee
  entity.reward = event.params.reward
  entity.vestingPeriod = event.params.vestingPeriod
  entity.ended = false

  entity.save()
}

export function handleIncentiveEnded(event: IncentiveEnded): void {
  const entity = Incentive.load(event.params.incentiveId.toHex())
  if (entity != null) {
    entity.ended = true
    entity.save()
  }
}

export function handleDepositTransferred(event: DepositTransferred): void {
  let position = Position.load(event.params.tokenId.toString())
  if (!position) {
    position = getPosition(event, event.params.tokenId)
  }
  let oldOwner = YieldFarmer.load(event.params.oldOwner.toHex())
  if (!oldOwner) {
    oldOwner = new YieldFarmer(event.params.oldOwner.toHex())
    oldOwner.save()
  }
  let newOwner = YieldFarmer.load(event.params.newOwner.toHex())
  if (!newOwner) {
    newOwner = new YieldFarmer(event.params.newOwner.toHex())
    newOwner.save()
  }
  if (Address.fromHexString(position.minter).equals(Address.fromHexString(ADDRESS_ZERO))) {
    position.minter = oldOwner.id
  }
  position.owner = newOwner.id
  position.save()
}

export function handleRewardClaimed(event: RewardClaimed): void {
  let farmer = YieldFarmer.load(event.transaction.from.toHex())
  if (!farmer) {
    farmer = new YieldFarmer(event.transaction.from.toHex())
    farmer.save()
  }

  let rewardToken = ERC20Token.load(event.params.rewardToken.toHex())
  if (!rewardToken) {
    rewardToken = new ERC20Token(event.params.rewardToken.toHex())
    const binding = ERC20.bind(event.params.rewardToken)
    rewardToken.name = binding.name()
    rewardToken.symbol = binding.symbol()
    rewardToken.decimals = binding.decimals()
    rewardToken.save()
  }
  const claim = new Claim(event.transaction.hash.toHex() + '#' + event.logIndex.toHex())
  claim.txHash = event.transaction.hash
  claim.timestamp = event.block.timestamp
  claim.blockNumber = event.block.number
  claim.amount = event.params.reward
  claim.rewardToken = rewardToken.id
  claim.farmer = farmer.id
  claim.save()
}

export function handleTokenStaked(event: TokenStaked): void {
  let position = Position.load(event.params.tokenId.toString())
  if (!position) {
    position = getPosition(event, event.params.tokenId)
    if (position) {
      position.save()
    } else {
      return
    }
  }

  let farmer = YieldFarmer.load(event.transaction.from.toHex())
  if (!farmer) {
    farmer = new YieldFarmer(event.transaction.from.toHex())
    farmer.save()
  }

  const stake = new Stake(event.transaction.hash.toHex() + '#' + event.logIndex.toHex())
  stake.farmer = farmer.id
  stake.txHash = event.transaction.hash
  stake.timestamp = event.block.timestamp
  stake.position = position.id
  stake.blockNumber = event.block.number

  let incentivePosition = IncentivePosition.load(
    event.params.incentiveId.toHex() + '#' + event.params.tokenId.toString()
  )
  if (!incentivePosition) {
    incentivePosition = new IncentivePosition(event.params.incentiveId.toHex() + '#' + event.params.tokenId.toString())
    incentivePosition.position = event.params.tokenId.toString()
    incentivePosition.incentive = event.params.incentiveId.toHex()
    incentivePosition.claimed = new BigInt(0)
    incentivePosition.save()
  }

  const incentive = Incentive.load(incentivePosition.incentive)
  if (!incentive) {
    return
  }
  stake.rewardToken = incentive.rewardToken
  stake.save()
}

export function handleTokenUnstaked(event: TokenUnstaked): void {
  // IncentivePosition add collect amount
  const position = Position.load(event.params.tokenId.toString())
  if (!position) {
    return
  }

  const unstake = new Unstake(event.transaction.hash.toHex() + '#' + event.logIndex.toHex())
  unstake.txHash = event.transaction.hash
  unstake.timestamp = event.block.timestamp
  unstake.position = position.id
  unstake.blockNumber = event.block.number

  let farmer = YieldFarmer.load(event.transaction.from.toHex())
  if (!farmer) {
    farmer = new YieldFarmer(event.transaction.from.toHex())
    farmer.save()
  }

  unstake.farmer = farmer.id

  const incentivePosition = IncentivePosition.load(
    event.params.incentiveId.toHex() + '#' + event.params.tokenId.toString()
  )
  if (!incentivePosition) {
    return
  }

  const incentive = Incentive.load(incentivePosition.incentive)
  if (!incentive) {
    return
  }

  unstake.rewardToken = incentive.rewardToken
  unstake.save()
}

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FavouriteToggleButton from './FavouriteToggleButton'
import { renderWithProviders } from '../test/helpers'
import { useAuth } from '../hooks/useAuth'
import { useFavourites } from '../hooks/useFavourites'
import { createMockAuthValue } from '../test/helpers'

vi.mock('../hooks/useAuth')
vi.mock('../hooks/useFavourites')

const mockedUseAuth = vi.mocked(useAuth)
const mockedUseFavourites = vi.mocked(useFavourites)

const defaultFavouritesValue = {
  favourites: [],
  isLoading: false,
  addMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['addMutation'],
  removeMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['removeMutation'],
  isFavourite: vi.fn().mockReturnValue(false),
}

function mockHooks(
  authOverrides: Partial<ReturnType<typeof useAuth>> = {},
  favOverrides: Partial<typeof defaultFavouritesValue> = {},
) {
  mockedUseAuth.mockReturnValue(createMockAuthValue(authOverrides))
  mockedUseFavourites.mockReturnValue({ ...defaultFavouritesValue, ...favOverrides })
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('renders nothing when not authenticated', () => {
  mockHooks({ isAuthenticated: false })
  const { container } = renderWithProviders(<FavouriteToggleButton stationId="4076" />)
  expect(container.innerHTML).toBe('')
})

test('shows outline heart when station is not favourited', () => {
  mockHooks({ isAuthenticated: true })
  renderWithProviders(<FavouriteToggleButton stationId="4076" />)
  const btn = screen.getByRole('button', { name: 'Dodaj do ulubionych' })
  expect(btn).toHaveTextContent('♡')
})

test('shows filled heart when station is favourited', () => {
  mockHooks(
    { isAuthenticated: true },
    { isFavourite: vi.fn().mockReturnValue(true) },
  )
  renderWithProviders(<FavouriteToggleButton stationId="4076" />)
  const btn = screen.getByRole('button', { name: 'Usuń z ulubionych' })
  expect(btn).toHaveTextContent('♥')
})

test('click on unfavourited station calls add mutation', async () => {
  const addMutate = vi.fn()
  mockHooks(
    { isAuthenticated: true },
    { addMutation: { mutate: addMutate, isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['addMutation'] },
  )
  renderWithProviders(<FavouriteToggleButton stationId="4076" />)

  await userEvent.click(screen.getByRole('button', { name: 'Dodaj do ulubionych' }))
  expect(addMutate).toHaveBeenCalledWith('4076')
})

test('click on favourited station calls remove mutation', async () => {
  const removeMutate = vi.fn()
  mockHooks(
    { isAuthenticated: true },
    {
      isFavourite: vi.fn().mockReturnValue(true),
      removeMutation: { mutate: removeMutate, isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['removeMutation'],
    },
  )
  renderWithProviders(<FavouriteToggleButton stationId="4076" />)

  await userEvent.click(screen.getByRole('button', { name: 'Usuń z ulubionych' }))
  expect(removeMutate).toHaveBeenCalledWith('4076')
})

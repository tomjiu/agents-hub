package zai

import "errors"

func errorsIs(err error, target error) bool { return errors.Is(err, target) }
